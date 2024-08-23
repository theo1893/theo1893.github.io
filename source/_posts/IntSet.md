---
title: Redis源码图解(7) 底层编码IntSet
date: 2024-08-12 15:58:48
categories:
- Tech
tags:
- redis

---

# IntSet

IntSet是Set类型的可选编码, 其结构由数据编码、数据数量、数据存储3个部分组成, 等价于**有序数组**, 定义如下.

```c
typedef struct intset {
    /*
      数据编码, 可选:
      INTSET_ENC_INT16
      INTSET_ENC_INT32
      INTSET_ENC_INT64
    */
    uint32_t encoding;    
    uint32_t length;      // 数据数量
    int8_t contents[];    // 数据存储
} intset;
```

内存模型如下.

![](intset_memory.png)

## IntSet插入数据

由于IntSet可以用来存储任意类型的整型数据, 在当前编码位数不足以表示新数据时, 会出现编码升级的行为.

涉及编码升级的**新数据**插入流程如下图所示. 值得一提的是, IntSet的编码并没有降级的流程.

![](intset_insert.png)

在不涉及编码升级时, 额外增加了二分查找定位的过程, 如下图所示.

![](intset_insert_without_upgrading.png)



## IntSet删除数据

删除数据由二分查找定位, 迁移数据和释放内存3个步骤组成, 和插入数据十分类似, 这里不再额外介绍.
