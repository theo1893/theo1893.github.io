---
title: Redis源码图解(5) 底层编码QuickList
date: 2024-08-10 14:59:40
categories:
- Tech
tags:
- redis

---

# QuickList

QuickList是redis中List类型的可选编码, 比ListPack更高层, 涉及到多个结构体定义.

QuickList是由quicklistNode构成的双向链表, 包含指向表头和表尾的指针, 节点内的数据存储可能为下面两种类型:

* ListPack, 在未压缩的节点中使用;
* 原始数据, 在未压缩的节点中使用, 可以等价为char[];
* quicklistLZF, 在压缩节点中使用;

ListPack的定义在上一节已经给出, 因此在此略过, 其他相关结构体定义如下. :

```c
// QuickList结构
typedef struct quicklist {
    quicklistNode *head;
    quicklistNode *tail;
    unsigned long count;                  // 内部包含的总有效数据个数: 1个node可能包含N个有效数据
    unsigned long len;                    // 内部包含的总node数量
    signed int fill : QL_FILL_BITS;       // 填充系数, 默认为-2: 单个node内的有效荷载不应大于8kb
    /*
      压缩深度, 含义为超过这个深度的节点才会被压缩, 同时首尾节点永远不压缩
      compress == 1, 压缩情况为 [head] -> node -> node -> node -> [tail], 压缩3个节点
      compress == 2, 压缩情况为 [head] -> [node] -> node -> [node] -> [tail], 压缩1个节点
      默认为0, 不开启压缩
    */
    unsigned int compress : QL_COMP_BITS; 
    unsigned int bookmark_count: QL_BM_BITS;
    quicklistBookmark bookmarks[];
} quicklist;

// QuickListNode结构
typedef struct quicklistNode {
    struct quicklistNode *prev;
    struct quicklistNode *next;
    unsigned char *entry;          // 数据, 可能为: listpack(压缩)/listpack(未压缩)/原始字节(压缩)/原始字节(未压缩)
    size_t sz;                     // 压缩前的数据字节数
    unsigned int count : 16;       // entry中的有效数据个数, 对container=PLAIN的节点而言, 始终为1
    /*
      encoding==RAW(1): 节点未压缩
      encoding==LZF(2): 节点被压缩
    */
    unsigned int encoding : 2;
    /*
      container==PLAIN(1): 以原始字节存储listpack放不下的数据, 默认大于8kb; PLAIN节点不允许再写入数据
      container==PACKED(2), 以listpack结构存储数据, 如果不超过8kb, 可以继续写数据
    */
    unsigned int container : 2;  
    /*
      0-此节点未被压缩过
      1-此节点曾经被压缩过, 现在由于被访问而处于未压缩状态
    */
    unsigned int recompress : 1;   
    unsigned int attempted_compress : 1; 
    unsigned int dont_compress : 1; 
    unsigned int extra : 9; 
} quicklistNode;


// QuickList数据压缩结构
typedef struct quicklistLZF {
    size_t sz;            // 压缩后的数据字节数
    char compressed[];    // 压缩后的数据
} quicklistLZF;
```

QuickList的内存模型如下图所示:

![](quicklist_memory.png)

## QuickList数据压缩/解压

在向QuickList查询/插入/删除数据时, 根据位置和配置的压缩深度, 可能会触发对节点的压缩和解压操作.

Redis使用的是LZF算法, [相关链接](http://oldhome.schmorp.de/marc/liblzf.html]).  下图展示了对某一节点进行压缩的流程. 解压是压缩的逆操作, 行为基本一致, 不作额外图示.

![](quicklist_compress.png)

## QuickList查询数据

由于QuickList在设计上基本等价于双向链表, 因此遍历方向在查询中的影响并不大, 这里不做介绍. 

在查询过程中需要注意的是QuickList对压缩节点的处理: 由于压缩节点无法直接用来获取数据, 因此在遍历到压缩节点时, QuickList会将节点进行解压, 然后进行常规遍历, 后续有2种情况:

1. 解压节点后, 发现查询的数据在此节点中, 此节点被命中, 维持在解压状态, 在未来的操作中再被压缩;
2. 解压节点后, 发现查询的数据未在此节点中, 此节点未被命中, 重新被压缩; 继续遍历后续的节点;

情况1的查询流程如下图所示.

![](quicklist_query.png)



## QuickList插入数据

假设QuickList包含4个节点, 压缩深度配置=1, 填充系数=-2, 根据插入数据大小 + 插入位置区分情况讨论.

### 插入数据大于8kb

由于填充系数为-2, 每个ListPack的有效荷载最大为8kb, 因此这条数据无法使用ListPack存储, 需要使用新的QuickListNode以原始数据格式存储.

需要注意的是, 如果这条数据的插入位置在**某个节点A的中间**, 会导致节点A分裂为[A1, A2] 2个节点, 然后自己作为新节点插在中间, 成为[A1, Node, A2]. 由于这个情况和下面插入新节点流程一致, 这里不单独描述.

#### 新节点插入在非压缩区域

在这里的场景中, 非压缩区域仅有队头和队尾. 假设数据被插入队头前/队尾后, 这个操作会导致旧的队头/队尾被挤进压缩区域而被压缩. 

整个QuickList的变化情况如下图所示.

![](quicklist_new_node_in_uncompress_region.png)

#### 新节点插入在压缩区域

数据被插入压缩区域时, 不会影响到原有节点的压缩状态, 插入如下图所示.

![](quicklist_new_node_in_compression_region.png)



### 插入数据小于8kb

在这种情况下, 数据有两种可能: 

1. 指定位置的节点空间还能够容纳这条数据, 于是这条数据被插入该节点;
2. 指定位置的节点无法再容纳这条数据, 于是继续遍历直到找到一个可以容纳数据的节点;

2的本质和1相同, 因此这里只介绍1的情况.

#### 数据插入被压缩节点

在指定插入位置时, 会先执行一次查询操作, 因此在定位结束后, 被命中的节点已经处于解压状态, 数据会被写入ListPack, 写入完成后节点再次被压缩.

整个流程如下图所示.

![](quicklist_insert_into_compressed_node.png)



#### 数据插入未压缩节点

流程和上图基本一致, 区别仅在于压缩/解压, 这里不单独描述.

