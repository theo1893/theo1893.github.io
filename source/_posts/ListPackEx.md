---
title: Redis源码图解(6) 底层编码ListPackEx
date: 2024-08-10 17:15:14
categories:
- Tech
tags:
- redis

---

# ListPackEx

ListPackEx是在ListPack基础上增加元数据后得到的新编码, 但和ListPack的所处层级不同, 虽然在实现上是底层编码, 但从逻辑上而言, 实际上**高于底层编码, 低于高层类型**. 当前ListPackEx仅被用来支持Hash的过期机制.

在实现上, ListPackEx由3个部分组成: 过期相关的元数据, Hash表Key, 指向ListPack的指针.

在ListPackEx的使用场景中, 其指向的ListPack中必然是**每3个元素成组地出现**.

ListPackEx的内存模型如下, 每个三元组中, 第1个是key, 第2个是value, 第3个是这组k-v设置的过期时间.

![](listpackex_memory.png)

## ListPackEx插入数据

向ListPackEx插入新数据分为2种情况:

1. 插入数据永不过期;
2. 插入数据存在过期时间;

针对情况1, 新数据永远会追加在ListPackEx的队列尾部.

针对情况2, 新数据会被插入到第一个晚于自身过期时间的元素之前, 即队列按照过期时间升序增长.

下图展示了向队列中插入带过期时间数据的流程.

![](listpackex_insert.png)

## ListPackEx删除数据

删除逻辑和ListPack完全一致, 区别仅在于每次会同时删除3个元素, 这里不单独描述.
