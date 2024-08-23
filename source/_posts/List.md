---
title: Redis源码图解(11) 高级类型List
date: 2024-08-16 18:00:56
categories:
- Tech
tags:
- redis

---

# List

List是Redis高级类型之一, 可选2种底层编码:

1. OBJ_ENCODING_LISTPACK, 在数据量小时使用;
2. OBJ_ENCODING_QUICKLIST, 通常编码;

在插入数据和删除数据时都可能会触发编码转换.

## List插入数据

在插入数据时, 如果原始编码是OBJ_ENCODING_LISTPACK, 而插入数据后超出了配置的size阈值(默认8KB), 会由LISTPACK转为QUICKLIST. 转换时的内存模型如下图所示.

![](list_insert_growing.png)

插入数据本身的流程并不复杂, 即定位+插入数据, 此处不做描述.

## List删除数据

删除流程的流程和插入数据类似, 不做描述.

需要注意的是, List删除数据后可能触发缩容操作, 导致编码从QUICKLIST转换为LISTPACK. 具体的条件是: 数据删除完成后, 剩余数据的长度小于size阈值的一半(即默认4KB). 转换时的内存模型如下图所示.

![](list_delete_shrinking.png)
