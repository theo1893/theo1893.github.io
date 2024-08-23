---
title: Redis源码图解(2) 底层编码SDS
date: 2024-08-06 16:43:10
categories:
- Tech
tags:
- redis

---

# SDS(Simple Dynamic String)

SDS是redis中**所有**字符型数据的底层存储结构, 包含3个header字段和实际的数据存储:

``` c
// 以sdshdr8举例; 不同的hdr区别仅在于名字和len, alloc的数据类型
struct __attribute__ ((__packed)) sdshdr8 {
    uint8_t len;			// 当前已使用字节数
    uint8_t alloc;			// 当前分配空间
    unsigned char flags;	// 记录sds的类型: SDS_TYPE_8, SDS_TYPE_16...
    char buf[];				// 字符数据存储
}

struct __attribute__ ((__packed)) sdshdr16 {
    uint16_t len;			
    uint16_t alloc;			
    unsigned char flags;	
    char buf[];				
}

struct __attribute__ ((__packed)) sdshdr32 {
    uint32_t len;			
    uint32_t alloc;			
    unsigned char flags;	
    char buf[];				
}

struct __attribute__ ((__packed)) sdshd64 {
    uint64_t len;			
    uint64_t alloc;			
    unsigned char flags;	
    char buf[];				
}
```

在实现上, 每个sds对象指针会指向buf的起始地址, 使用起来就像操作字符数组. sds的内存结构如下:

![](sds_memory.drawio.png)

sds初始化流程如下:

![](sds_init.drawio.png)

