---
title: Redis源码图解(1) RedisObject
date: 2024-08-05 13:54:39
categories:
- Tech
tags:
- redis

---

# Redis Object

Redis Object是redis对外提供的**最基础**的数据类型, 对用户而言, 能够直接接触到的对象全部是Redis Object类型.

``` c
typedef struct redisObject {
    unsigned type:4;		// 数据类型
    unsigned encoding:4;	// 数据编码
    unsigned lru:LRU_BITS;	// 最后一次使用时间戳，和过期机制相关
    int refcount;			// 引用数
    void *ptr;				// 指向底层数据的指针
} robj;

// 对常见顶层类型而言, type的枚举如下
#define OBJ_STRING 0    
#define OBJ_LIST 1      
#define OBJ_SET 2       
#define OBJ_ZSET 3      
#define OBJ_HASH 4      

// 类型的编码encoding枚举如下
#define OBJ_ENCODING_RAW 0          // 原始编码      
#define OBJ_ENCODING_INT 1          // 使用int存储
#define OBJ_ENCODING_HT 2           // 使用hash table存储
#define OBJ_ENCODING_ZIPMAP 3       // **不再使用**
#define OBJ_ENCODING_LINKEDLIST 4   // **不再使用**
#define OBJ_ENCODING_ZIPLIST 5      // **不再使用**
#define OBJ_ENCODING_INTSET 6       // 使用intset存储
#define OBJ_ENCODING_SKIPLIST 7     // 使用skiplist存储
#define OBJ_ENCODING_EMBSTR 8       // 使用embedded sds存储
#define OBJ_ENCODING_QUICKLIST 9    // 使用quicklist存储, 本质是listpack链表
#define OBJ_ENCODING_STREAM 10      // 使用由listpack构成的radix tree存储
#define OBJ_ENCODING_LISTPACK 11    // 使用listpack存储
#define OBJ_ENCODING_LISTPACK_EX 12 // 使用listpack存储, 附带metadata
```

可能的内存分布:

![](redis_object.drawio.png)
