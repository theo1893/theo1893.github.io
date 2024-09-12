---
title: Golang杂学 Map结构
date: 2024-09-09 13:53:47
categories:
- Tech
tags:
- golang

---

# Map

本篇博客内容参考[Go程序员面试笔试宝典](https://golang.design/go-questions/map/principal/), 相关流程和代码基于Go 1.22.3版本.

## Map底层数据结构

```go
// map结构
type hmap struct {
    count     int     // 当前的k-v数量
    flags     uint8   // 按位表示当前map的部分状态, 取值见下面的常量
    B         uint8   // 当前bucket数量, 取log2
    noverflow uint16  // 当前overflow的bucket大致数量
    hash0     uint32  // 计算hash时使用的随机数种子

    buckets    unsafe.Pointer // bucket数组, 是内存中连续的bmap存储
    oldbuckets unsafe.Pointer // 旧的bucket, 在发生grow(rehash)时才会有值
    nevacuate  uintptr        // 下一次rehash时的bucket地址

    extra *mapextra
}

// bucket, k-v存储结构
type bmap struct {
    // 长度为8的byte数组, 因为每个bucket被规定只能存储8个k-v
    // 在常规情况下, tophash[i]存储对应位置hash(key)的高8位, 并且最小值为5, 用于快速定位key
    // 另外, tophash[i]可能取到下文的常量值, 用于表示对应位置数据的特殊状态
    tophash   [bucketCnt]uint8
    
    // ** 以下字段为动态添加, 没有实际源码定义 **
    keys      [bucketCnt]keyType      // 长度为8的key数组
    entries   [bucketCnt]entryType    // 长度为8的entry数组
    overflow  PtrSize                 // 下一个bmap
}

// tophash中的特殊标记, 当tophash[0]的取值为(1, 5)时,表示这个bucket已经被迁移完成 
const {
    emptyRest      = 0 // 这个位置是空, 并且后面全为空
    emptyOne       = 1 // 这个位置是空
    evacuatedX     = 2 // 这个位置的数据有效, 但已经被迁移到新的上半部分bucket中
    evacuatedY     = 3 // 这个位置的数据有效, 但已经被迁移到新的下半部分bucket中
    evacuatedEmpty = 4 // 这个位置是空, 并且这个bucket已经全部迁移完成了
    minTopHash     = 5 // 最小的常规hash值
}

// flags的位值
const {
    iterator     = 1 // buckets可能在被遍历
    oldIterator  = 2 // oldbuckets可能在被遍历
    hashWriting  = 4 // 正在被写入
    sameSizeGrow = 8 // rehash后的map和现在的map大小相同
}
```

Golang中Map底层结构为hmap. hmap包含2个指向bmap的指针, 分别指向当前使用的bucket数组和旧的bucket数组.

数据模型如下图所示.

![](map_model.png)

以下面这段代码为例, 变量m在内存中的可能分布如下图所示.

```go
func main() {
    m := make(map[string]int)
    m["v"] = 100
    fmt.Println(m)
}
```

![](map_demo.png)

## 插入数据

插入数据的流程图和内存变化图如下所示. 

**通常情况下**, 如果当前负载已经超过6.5, 则hmap触发扩容, 将空间扩为2倍.  

如果bucket串得太多(出现了稀疏的长链表), 也会触发hmap的扩容, 但扩容后空间大小不变, 仅尝试通过迁移数据进行空间压缩.

![](map_insert.png) 

### 扩容过程中旧的bucket失效吗?

hmap.oldbuckets字段, 仅在扩容迁移彻底完成时才被置为空. 因此, **在扩容过程中, hmap中存储着新旧两套数据**.

与golang的实现相对, redis中的dict结构, 在rehash过程中, 每迁移一个bucket, 就会删除旧的数据, 因此**在redis dict的rehash过程中, 同一份数据在内存中仅有一份存储**.

### 如果使用NAN作为key, 插入时会发生什么?

每次插入NAN的key, 在计算哈希时都会被引入随机数. 因此每次插入NAN, 实际是插入互不关联的key.

```go
// 计算float64的哈希函数
func f64hash(p unsafe.Pointer, h uintptr) uintptr {
    f := *(*float64)(p)
    switch {
    case f == 0:
        return c1 * (c0 ^ h) 
    case f != f:
        return c1 * (c0 ^ h ^ uintptr(rand())) // NAN被引入随机数
    default:
        return memhash(p, h, 8)
    }
}
```

## 删除数据

删除数据的流程和插入数据基本一致, 区别在于定位到位置后的行为. 删除数据会将key和entry清空, 并更新hashtop中对应字节为emptyOne(1)或者emptyRest(0), 为简化描述, 更新细节略过.

![](map_delete.png)

## 遍历数据

这里指For-Range的遍历操作. 

由于在扩容阶段, oldbuckets中的数据会分裂到新的buckets中的2个位置(eg, 旧bucket=3中的数据, 在buckets长度从4增长为8后, 会被迁移到新bucket=3/7这2个bucket中), 在遍历过程中golang采用以下逻辑:

遍历到的bucketN, 仅返回**逻辑上**属于bucketN的数据.

举例说明:

1. 当遍历到新bucket7时, 发现旧bucket3没有迁移完成, 因此将当前遍历对象改为旧bucket3. 
2. 对旧bucket3中的每个key, 如果key映射到新bucket7, 则正常返回, 如果映射到新bucket3, 则跳过这个key.

图示如下.

![](map_iter_demo.png)

下面给出对map进行For-Range遍历的流程, 如果当前Bucekt处于上述描述的状态, 按照上述流程处理, 下面不单独给出细节.

1. 初始化迭代器, 迭代器从**随机**Bucket(记为startBucket)的**随机**Key(记为startKey)开始迭代(这也是每次迭代结果都不同的原因).
1. 按顺序向后查询每一组有效的Key-Value, 并将其返回.
1. 在迭代器遍历到startBucket上的startKey-1后, 迭代器终止.

迭代流程图如下所示.

![](map_iter_process.png)

