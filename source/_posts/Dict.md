---
title: Redis源码图解(3) 底层编码HT(Dict)
date: 2024-08-08 13:28:37
categories:
- Tech
tags:
- redis

---

# Dict

Dict是redis中最底层的哈希结构, 是Redis DB、Expire DB等结构的数据存储部分, 也是Hash, Set, ZSet等类型的可选数据编码. 其定义如下:

```c
struct dict {
    dictType *type;               // 函数指针集合, 保存dict用来比较key、计算hash等操作的函数
    dictEntry **ht_table[2];      // 2个table, 其中1个用于当前使用，另一个用于rehash
    unsigned long ht_used[2];     // 记录对应table中存储的数据的数量

    long rehashidx;               // 记录rehash的bucket, 如果==-1, 则未处于rehash
    unsigned pauserehash : 15; 
    unsigned useStoredKeyApi : 1; 
    signed char ht_size_exp[2];   // 记录table分配空间的幂, 比如table[0]分配了15个内存空间, exp[0]就为4
    int16_t pauseAutoResize;  
    void *metadata[];             // 存储Hash类型的过期相关信息
};

typedef struct dictType {
    uint64_t (*hashFunction)(const void *key);	// 用于计算hash的函数
    void *(*keyDup)(dict *d, const void *key);
    void *(*valDup)(dict *d, const void *obj);
    int (*keyCompare)(dict *d, const void *key1, const void *key2);	// 用于比较key的函数
    void (*keyDestructor)(dict *d, void *key);
    void (*valDestructor)(dict *d, void *obj);
    int (*resizeAllowed)(size_t moreMem, double usedRatio);
    ......
}
```

Dict中实际用于数据存储的table由DictEntry构成, 是redis中k-v存储的核心单元. 其定义如下:

```c
struct dictEntry {
    void *key;                 // 存储的key
    union {
        void *val;             // 下面3个类型存不了的数据就放在这里
        uint64_t u64;
        int64_t s64;
        double d;
    } v;                       // 存储的value
    struct dictEntry *next;    // 链到下一个entry上, 构成链表
};

// 这是一种特殊的entry, 只包含key, 在DB过期机制中使用
typedef struct {
    void *key;
    dictEntry *next;
} dictEntryNoValue;
```

较为直观的内存分布如下图所示:

![](dict_memory.drawio.png)

## Dict插入数据

向Dict插入数据可能会触发dict的扩容rehash, 同时如果dict已经处于rehash状态, 还涉及到步进式rehash的处理,  因此整个流程可以大致分为4个部分: 执行步进rehash(非必须), 扩容进入rehash状态(非必须), 根据指定的key定位到dictEntry, 写入数据. 

整体流程如下图所示, 右侧展示了未涉及table[1]的数据插入:

![](dict_insert.png)



## Dict删除数据

从Dict删除数据和向Dict插入数据流程十分类似, 不同点主要在于:

1. 从可能触发扩容变为可能触发缩容;
2. 定位到dictEntry后将其从链表移除, 同时释放资源;

整体流程如下所示, 右侧展示了未涉及table[1]的数据删除:

![](dict_delete.png)
