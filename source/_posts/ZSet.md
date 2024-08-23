---
title: Redis源码图解(13) 高级类型ZSet
date: 2024-08-17 13:06:39
categories:
- Tech
tags:
- redis

---

# ZSet(TEST)

ZSet是Redis的高级类型之一, 可选2种底层编码:

1. OBJ_ENCODING_LISTPACK, 用在数据量少的场景;
2. OBJ_ENCODING_QUICKLIST, 通用编码;

## 编码为LISTPACK时的内存模型

如下图所示, LP中的数据为二元组(key, score), 在插入时保证升序.

![](zset_listpack_memory.png)

## ZSet插入数据

在插入新数据时, 可能出现编码转换, 流程如下图所示, 与Set的编码转换判断基本一致.

![](zset_listpack_to_skiplist.png)

需要注意的是, 由于ListPack本身不带有顺序概念, 在使用LISTPACK作为ZSet的编码时, 插入数据时会从前向后遍历数据找到插入点, 保证ListPack的升序.

插入流程不做介绍.

## ZSet删除数据

ZSet删除数据不会触发编码转换. 

删除流程根据编码不同而不同, 本质是调用底层编码的删除逻辑, 此处不做介绍.

