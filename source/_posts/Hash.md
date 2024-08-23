---
title: Redis源码图解(10) 高级类型Hash
date: 2024-08-15 12:19:47
categories:
- Tech
tags:
- redis

---

# Hash

Hash是Redis的高级类型之一, 可选3种底层编码:

1. OBJ_ENCODING_LISTPACK, 是初始的默认编码, 用于**小数据量**和**小数据**的存储, 对应的数据结构为ListPack;
2. OBJ_ENCODING_LISTPACK_EX, 带expire信息的listpack;
3. OBJ_ENCODING_HT, 通用存储, 对应的数据结构为Dict.

内存模型如下.

![](hash_memory.png)

## 编码转换

由于Hash底层涉及3种编码, 其中还包含带过期和不带过期的版本, 编码之间的转换非常复杂, 此处单独进行介绍.

Hash在数据量较小且数据本身较小时使用ListPack进行存储, 如果这张哈希表存在过期的设置, 则会转换为ListPackEx; 在插入大量的数据或大数据后, 编码从LiskPack/ListPackEx升级到Dict;

基于上述流程, 编码转换分为以下几个方向:

1. ListPack转换为ListPackEx;

2. ListPack转换为Dict;

3. ListPackEx转换为Dict;

### ListPack转换为ListPackEx
流程较为简单, 在ListPack中每组2个Entry后, 增加1个Entry记录TTL, 最后封装一个ListPackEx结构替换ROBJ的数据指针即可. 下图左侧展示了转换流程, 右侧是内存变化.

![](hash_listpack_to_listpackex.png)

### ListPack转换为Dict

将ListPack中存储的每组Key-Data, 转换为HField-Data, 写入新的Dict中即可, 最后将ROBJ的数据指针指向Dict. 

HField是对Key进行字符串变换后得到的输出, 是在原始字符串之前增加了mstrhdr用于记录元数据. mstrhdr的结构定义如下. 

```c 
struct __attribute__ ((__packed__)) mstrhdr5 {
    unsigned char info; // 低2位记录type, 1位记录是否带metadata, 剩下5位记录buf长度
    char buf[];
};
struct __attribute__ ((__packed__)) mstrhdr8 {
    uint8_t unused;     // 不实际使用
    uint8_t len;        // buf长度
    unsigned char info; // 低2位记录type, 1位记录是否带metadata, 其余位不用
    char buf[];
};
struct __attribute__ ((__packed__)) mstrhdr16 {
    uint16_t len;
    unsigned char info; // 低2位记录type, 1位记录是否带metadata, 其余位不用
    char buf[];
};
struct __attribute__ ((__packed__)) mstrhdr64 {
    uint64_t len;
    unsigned char info; // 低2位记录type, 1位记录是否带metadata, 其余位不用
    char buf[];
};
```

以原始Key长度在[256, 65536)之间为例, Key被转换为HFiled后, 内存分布如下图所示. 在原始Key的基础上, HField增加了3个字节来记录和过期相关的数据.

![](hash_hfield.png)

而对info字段而言, 其内部的位分布如下图所示.

![](hash_mstrhdr_pinfo.png)

进而, 我们可以得到ListPack转换为Dict的流程, 如下图所示, 右侧是内存变化.

![](hash_listpack_to_dict.png)

### ListPackEx转换为Dict

由于ListPackEx包含了过期信息, 因此构建的HField比上文多了一些空间, 用于存放这个Key的过期信息. 示意图如下.

![](hash_hfield_with_metadata.png)

相应地, 在把数据写入Dict时, 也会将这个HField写进Dict.matadata, 用于Hash的过期机制. 整体流程大致如下.

![](hash_listpackex_to_dict.png)

#### Dict.metadata里是什么东西?

Redis在Dict.metadata中使用Rax Tree前缀树([参考资料](http://mysql.taobao.org/monthly/2019/04/03/))来存储HField. Key的长度为6个Byte(Hash只支持最多48bit的过期时间), 通过HField的expiry计算而来, 计算方式如下图所示.

![](hash_hfield_rax_key.png)

二进制前缀相同的过期时间被收拢到一起, 构成了前缀树, 在过期清理的流程中方便查询.

## Hash插入数据

向Hash插入数据的流程图如下.  值得注意的是, 由于在向Hash插入数据时无法指定过期时间, 因此**如果指定的Key存在旧的数据并且有过期时间, 会被更新为0, 即永不过期**.

![](hash_insert.png)







