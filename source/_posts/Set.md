---
title: Redis源码图解(12) 高级类型Set
date: 2024-08-17 11:33:45
categories:
- Tech
tags:
- redis

---

# Set

Set是Redis的高级类型之一, 可选3种底层编码:

1. OBJ_ENCODING_INTSET, 在数据量较小, 并且全是整型数据时, 使用INTSET来节省内存;
2. OBJ_ENCODING_LISTPACK, 在数据量较小, 但存在非整型数据时, 使用LISTPACK;
3. OBJ_ENCODING_HT, 通用编码;

## Set插入数据

向Set插入数据可能会触发编码转换, 需要分情况讨论. 而插入数据本身并不复杂, 在之前的编码图解中已经都有介绍过, 这里不做额外描述.

### 当前为INTSET

编码转换的判断如下图所示, INTSET可能出现向LISTPACK或HT的转换.

![](set_intset_conversion.png)

### 当前为LISTPACK

编码转换的判断如下图所示, LISTPACK仅在超过阈值时会向HT转换.

![](set_listpack_conversion.png)

### 当前为HT

不会转换. HT是最后的编码.

## Set删除数据

在删除数据时, 并不会发生编码转换.

删除数据的流程比较简单, 对3个编码而言均是定位+删除, 前面的图解已经对各个编码单独介绍过, 这里不再过多描述.
