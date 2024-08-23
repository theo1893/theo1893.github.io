---
title: Redis源码图解(8) 底层编码SkipList
date: 2024-08-13 12:46:12
categories:
- Tech
tags:
- redis

---

# SkipList

SkipList是ZSet的可选编码之一, 在Redis中被命名为zskiplist.

ZSkipList是一种层级有序双向链表, 提供了接近二分查找的查询能力, 由ZSkipListNode构成. 

每个ZSkipListNode包含N个前向指针和1个后向指针, 每个前向指针处于不同的层级上, 同时记录了下一跳移动的步长.

ZSkipList的最大层级无法高于32. 列表中第一个节点, 即头结点不用于数据存储, 而是包含全部的32个层级的指针, 完全作为起始节点发挥作用.

相关结构体定义如下所示.

```c
typedef struct zskiplistNode {
    sds ele;                              // 存储的数据, 以sds格式存储; 头结点为null
    double score;                         // 数据对应的权重
    struct zskiplistNode *backward;       // 后向指针
    struct zskiplistLevel {
        struct zskiplistNode *forward;    // 此节点在某层级的下一跳前向指针
        unsigned long span;               // 此节点在某层级的下一跳步长
    } level[];                            // 层级数组
} zskiplistNode;

typedef struct zskiplist {
    struct zskiplistNode *header, *tail;  // 头尾指针
    unsigned long length;                 // 当前skiplist的节点数量
    int level;                            // 当前skiplist最大层级
} zskiplist;
```

图示如下.

![](skiplist_memory.png)



## SkipList插入数据

为方便描述, 后续SkipList会以下面这种简化形式表示, 方块内的数字表示节点在该层级的span. 

在下图中, 左侧的节点在level[0]需要跳跃1次, 到达右侧的节点, 而在其他层级没有办法跳跃到右侧节点.

![](skiplist_node.png)

下面给出向SkipList插入数据的流程. Redis在向SkipList写入数据时, 可以大致分为以下3个步骤:

1. 为这条新数据随机分配一个最大层级L, 在[1, 32]之间取值(越高的层级概率越小);
2. 将新节点定位到该插入的位置;
3. 从高层级向低层级遍历更新现存节点的跳数;

下图展示了向SkipList插入新节点的过程, 每一轮中, 绿色是新增加的节点, 蓝色是涉及到跳数更新的节点内存空间. 

需要注意的是, **数据节点的span可能存在2种含义**: 跳向同层级下一节点的步长, 跳向队尾的步长. 而头结点的span仅有一种含义: 跳向同层级下一节点的步长.

![](skiplist_insert.png)



## SkipList查询数据

在SkipList上查询数据分2种类型: 基于索引查询, 基于权重查询. 

虽然Redis提供了两种查询方式, 但对SkipList而言查询逻辑是基本一致的: 从高层级到低层级跳跃查询, 查询粒度从粗到细.

下图展示了SkipList查询数据的流程, 红色表示查询后回退的路径, 紫色表示最终的路径.

![](skiplist_query.png)



## SkipList删除数据

SkipList删除数据较为简单, 分为以下几个步骤:

1. 查询定位到要删除的节点;
2. 移除节点, 更新链表;
3. 释放资源;

这里不单独叙述.
