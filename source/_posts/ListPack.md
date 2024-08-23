---
title: Redis源码图解(4) 底层编码ListPack
date: 2024-08-09 16:40:20
categories:
- Tech
tags:
- redis

---

# ListPack

ListPack是redis中List类型的可选编码, 用在数据量较小的List上.

ListPack由3个部分组成:

* Header, 记录ListPack的Entry数和总字节数;

* Entry, 是ListPack的数据单元, 由编码后的数据(变长)和当前数据的字节数(变长, 最大为5Byte)组成, 其中记录当前数据的字节数是为了支持ListPack从尾部向头部的遍历(起到记录偏移量的作用);

* EOF, 标记ListPack的结束;

ListPack没有在代码中的结构体定义, 通过宏和内存函数直接操作内存, 其等价内存模型如下图所示:

![](listpack_memory.png)



## ListPack插入数据

在了解ListPack的内存模型后, 向ListPack写入数据的流程就变得非常清晰, 主要分为以下步骤:

1. 将原始数据编码为Entry;
2. 重新分配内存;
3. 将旧数据拷贝道新的内存中;
4. 将Entry写入新的内存指定偏移位置;
5. 更新ListPack头;

图示如下:

![](listpack_insert.png)



## ListPack删除数据

和插入类似, 删除操作也分为以下步骤:

1. 解码Entry的总字节数;

2. 重新分配内存;

3. 将旧数据拷贝到新的内存中;

4. 更新ListPack头;

图示如下:

![](listpack_delete.png)
