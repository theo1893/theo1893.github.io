---
title: Redis源码图解(22) Redis RDB存储流程
date: 2025-02-24 23:15:31
categories:
- Tech
tags:
- redis
---



# Redis RDB存储流程

和AOF记录对数据的操作指令不同, RDB文件是将Redis当前全部的数据以**原始数据**的格式进行快照存储.

下面以bgsave指令为例, 简单分析RDB存储的流程.

## BGSAVE触发RDB存储

RDB存储和AOF存储有几个共同点:

1. 在被触发时不允许存在其他后台进程同时处理;
2. Fork子进程后, 父进程和子进程的Resize策略会被收紧;
3. 在对实际数据进行处理时, 分不同的数据类型, 有不同的写入逻辑;

BGSAVE的同步执行流程如下图所示.

![](sync_rdb.png)



## 不同数据类型的存储格式

这里可以细分为三个子步骤: 写入编码类型, 写入Key, 写入Value.

### 写入编码类型

```c
#define OBJ_ENCODING_RAW 0     /* Raw representation */
#define OBJ_ENCODING_INT 1     /* Encoded as integer */
#define OBJ_ENCODING_HT 2      /* Encoded as hash table */
#define OBJ_ENCODING_ZIPMAP 3  /* No longer used: old hash encoding. */
#define OBJ_ENCODING_LINKEDLIST 4 /* No longer used: old list encoding. */
#define OBJ_ENCODING_ZIPLIST 5 /* No longer used: old list/hash/zset encoding. */
#define OBJ_ENCODING_INTSET 6  /* Encoded as intset */
#define OBJ_ENCODING_SKIPLIST 7  /* Encoded as skiplist */
#define OBJ_ENCODING_EMBSTR 8  /* Embedded sds string encoding */
#define OBJ_ENCODING_QUICKLIST 9 /* Encoded as linked list of listpacks */
#define OBJ_ENCODING_STREAM 10 /* Encoded as a radix tree of listpacks */
#define OBJ_ENCODING_LISTPACK 11 /* Encoded as a listpack */
#define OBJ_ENCODING_LISTPACK_EX 12 /* Encoded as listpack, extended with metadata */
```

在本系列介绍Redis Object时我们知道, Redis的高层数据类型实际会有种可选的底层编码, 比如List在数据量小时使用ListPack存储, 在数据量大时使用QuickList存储.

在RDB存储流程中, 对一个Redis Object, 首先写入的就是对象的底层编码, 占用RDB文件的1个Byte.

### 写入Key

此时会把这个Object的Key写入RDB文件. 这里Redis会进行优化——实际上Redis在大量的地方都会进行这一类优化——会尝试使用Int类型来表示这个Key:

如果Key确实是整型数据, 那么Redis会尝试对这个整型数据进行编码. 

如果Key无法以整型数据表示, 那么会保持SDS的数据格式, 尝试用LZF算法压缩空间占用.

经过优化后, Key被写入RDB文件.

### 写入Value

这里以QuickList编码的List类型为例, Redis按照下面的步骤将一个完整的List写入RDB文件:

1. 写入List中Node的个数;
2. 遍历每个Node;
	1. 写入Node中元素的个数;
	2. 把Node的数据整个写入RDB;

在把Object的Value写入RDB后, 这个Object的写入彻底完成.

下图展示了名为demolist的, 元素个数为6的, 编码格式为QuickList的List对象, 是如何被写入RDB文件.

![](write_object.png)



## RDB文件写入完成后

主要做了一些收尾工作:

1. 执行fsync刷盘;
2. 重命名RDB文件为dump.rdb;
