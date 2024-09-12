---
title: Golang杂学 For-Range中的变量汇编分析
date: 2024-08-23 18:10:09
categories:
- Tech
tags:
- golang
---

# For-Range中的变量汇编分析

众所周知, 在Golang早期版本(1.22之前)中, For-Range得到的值如果送进协程进行并发处理, 非常危险, 原因是value在每一次循环中均为同一块内存. 

下面从汇编进行分析.

## 有误Demo

```go
// 有问题的demo
package main

import "fmt"

func main() {
	a := []int{11, 33, 55}

	for _, value := range a {
		foo(&value)
	}
}

func foo(v int) {
	fmt.Println(v)
}

// 对应的汇编代码切片
0x0021 00033 (main.go:8)  LEAQ    ""..autotmp_4+40(SP), CX
0x0026 00038 (main.go:8)  MOVUPS  X15, (CX)
0x002a 00042 (main.go:8)  LEAQ    ""..autotmp_4+32(SP), CX      // CX指向SP+32
0x002f 00047 (main.go:8)  MOVQ    CX, ""..autotmp_3+56(SP)
0x0034 00052 (main.go:8)  TESTB   AL, (CX)
0x0036 00054 (main.go:8)  MOVQ    $11, ""..autotmp_4+32(SP)     // 把11存在SP+32
0x003f 00063 (main.go:8)  TESTB   AL, (CX)
0x0041 00065 (main.go:8)  MOVQ    $33, ""..autotmp_4+40(SP)     // 把33存在SP+40
0x004a 00074 (main.go:8)  TESTB   AL, (CX)
0x004c 00076 (main.go:8)  MOVQ    $55, ""..autotmp_4+48(SP)     // 把55存在SP+48
0x0055 00085 (main.go:8)  TESTB   AL, (CX)
0x0057 00087 (main.go:8)  JMP     89
0x0059 00089 (main.go:8)  MOVQ    CX, "".list+72(SP)            // 把SP+32存在SP+72, 这里是sliceHeader的数据指针
0x005e 00094 (main.go:8)  MOVQ    $3, "".list+80(SP)            // 把3存在SP+80, 这里是len
0x0067 00103 (main.go:8)  MOVQ    $3, "".list+88(SP)            // 把3存在SP+88, 这里是cap
0x0070 00112 (main.go:10) LEAQ    type.int(SB), AX
0x0077 00119 (main.go:10) PCDATA  $1, $1
0x0077 00119 (main.go:10) CALL    runtime.newobject(SB)       // 在堆上新建int对象
0x007c 00124 (main.go:10) MOVQ    AX, "".&value+64(SP)        // 新建的int地址存入SP+64
0x0081 00129 (main.go:10) MOVQ    "".list+72(SP), CX
0x0086 00134 (main.go:10) MOVQ    "".list+80(SP), DX
0x008b 00139 (main.go:10) MOVQ    "".list+88(SP), BX
0x0090 00144 (main.go:10) MOVQ    CX, ""..autotmp_2+96(SP)
0x0095 00149 (main.go:10) MOVQ    DX, ""..autotmp_2+104(SP)
0x009a 00154 (main.go:10) MOVQ    BX, ""..autotmp_2+112(SP)
0x009f 00159 (main.go:10) MOVQ    $0, ""..autotmp_5+24(SP)
0x00a8 00168 (main.go:10) MOVQ    ""..autotmp_2+104(SP), CX
0x00ad 00173 (main.go:10) MOVQ    CX, ""..autotmp_6+16(SP)
0x00b2 00178 (main.go:10) JMP     180
0x00b4 00180 (main.go:10) MOVQ    ""..autotmp_5+24(SP), CX  // 进入循环, 接下来几条指令比较当前循环次数和3的大小
0x00b9 00185 (main.go:10) NOP
0x00c0 00192 (main.go:10) CMPQ    ""..autotmp_6+16(SP), CX
0x00c5 00197 (main.go:10) JGT     201                       // 进入循环
0x00c7 00199 (main.go:10) JMP     253                       // 退出循环
0x00c9 00201 (main.go:10) MOVQ    ""..autotmp_5+24(SP), CX  // 获取当前循环次数
0x00ce 00206 (main.go:10) SHLQ    $3, CX                    // 循环次数左移3位, 即乘以8, 作为接下来的取值地址偏移
0x00d2 00210 (main.go:10) ADDQ    ""..autotmp_2+96(SP), CX  // 获取sliceHeader的数据指针, 加上偏移
0x00d7 00215 (main.go:10) MOVQ    (CX), CX                  // 取值存入CX
0x00da 00218 (main.go:10) MOVQ    "".&value+64(SP), DX
0x00df 00223 (main.go:10) MOVQ    CX, (DX)                 // 把CX的数据存入SP+64的值所指的内存, 即堆上
0x00e2 00226 (main.go:11) MOVQ    "".&value+64(SP), AX
0x00e7 00231 (main.go:11) PCDATA  $1, $2
0x00e7 00231 (main.go:11) CALL    "".foo(SB)               // 调用foo()
0x00ec 00236 (main.go:11) JMP     238
0x00ee 00238 (main.go:10) MOVQ    ""..autotmp_5+24(SP), CX
0x00f3 00243 (main.go:10) INCQ    CX                       // 循环次数++, 再写入SP+24
0x00f6 00246 (main.go:10) MOVQ    CX, ""..autotmp_5+24(SP)
0x00fb 00251 (main.go:10) JMP     180
```

在上述汇编中可以看出, 在采用上述写法时, 变量value实际是**堆上**一块固定的内存区域, 在进入循环前申请. 因此, 在协程处理中, **多个协程会并发访问这块内存, 而非每个协程都有自己的入参**.

## 正确Demo

如下所示. 在显式引入newValue局部变量后, 在**每次循环内都会在堆上申请一块新的内存**, 然后用这块内存的地址作为foo()的入参, 因而不会出现问题.

```go
// 修改后的demo
package main

import (
	"fmt"
)

func main() {
	list := []int{11, 33, 55}

	for _, value := range list {
        // 显式使用新变量
		newValue := value
		foo(&newValue)
	}
}

func foo(v *int) {
	fmt.Println(v)
}

// 汇编切片
0x0038 00056 (main.go:8)  LEAQ    ""..autotmp_5+40(SP), CX    // CX指向SP+40
0x003d 00061 (main.go:8)  MOVQ    CX, ""..autotmp_4+64(SP)
0x0042 00066 (main.go:8)  TESTB   AL, (CX)
0x0044 00068 (main.go:8)  MOVQ    $11, ""..autotmp_5+40(SP)  // SP+40存储11
0x004d 00077 (main.go:8)  TESTB   AL, (CX)
0x004f 00079 (main.go:8)  MOVQ    $33, ""..autotmp_5+48(SP)  // SP+48存储33
0x0058 00088 (main.go:8)  TESTB   AL, (CX)
0x005a 00090 (main.go:8)  MOVQ    $55, ""..autotmp_5+56(SP)  // SP+56存储55
0x0063 00099 (main.go:8)  TESTB   AL, (CX)
0x0065 00101 (main.go:8)  JMP     103
0x0067 00103 (main.go:8)  MOVQ    CX, "".list+80(SP)         // 和上文相同, 这几条指令是sliceHeader赋值
0x006c 00108 (main.go:8)  MOVQ    $3, "".list+88(SP)
0x0075 00117 (main.go:8)  MOVQ    $3, "".list+96(SP)
0x007e 00126 (main.go:10) MOVQ    CX, ""..autotmp_3+104(SP)
0x0083 00131 (main.go:10) MOVQ    $3, ""..autotmp_3+112(SP)
0x008c 00140 (main.go:10) MOVQ    $3, ""..autotmp_3+120(SP)
0x0095 00149 (main.go:10) MOVQ    $0, ""..autotmp_6+32(SP)  // SP+32存储循环次数, 置为0
0x009e 00158 (main.go:10) MOVQ    ""..autotmp_3+112(SP), CX
0x00a3 00163 (main.go:10) MOVQ    CX, ""..autotmp_7+24(SP)
0x00a8 00168 (main.go:10) JMP     170
0x00aa 00170 (main.go:10) MOVQ    ""..autotmp_6+32(SP), CX  // 进入循环, 记下来判断循环次数是否已经超过3
0x00af 00175 (main.go:10) CMPQ    ""..autotmp_7+24(SP), CX
0x00b4 00180 (main.go:10) JGT     184
0x00b6 00182 (main.go:10) JMP     258
0x00b8 00184 (main.go:10) MOVQ    ""..autotmp_6+32(SP), CX  // 获取当前循环次数
0x00bd 00189 (main.go:10) SHLQ    $3, CX                    // 计算偏移量
0x00c1 00193 (main.go:10) ADDQ    ""..autotmp_3+104(SP), CX // 计算当前要处理的数据的地址
0x00c6 00198 (main.go:10) MOVQ    (CX), CX                  // 获取当前要处理的数据到CX
0x00c9 00201 (main.go:10) MOVQ    CX, "".value+16(SP)       // 数据存到SP+16
0x00ce 00206 (main.go:11) LEAQ    type.int(SB), AX
0x00d5 00213 (main.go:11) PCDATA  $1, $1
0x00d5 00213 (main.go:11) CALL    runtime.newobject(SB)     // 在循环内在堆上申请新的int对象
0x00da 00218 (main.go:11) MOVQ    AX, "".&newValue+72(SP)   // 地址放在SP+72
0x00df 00223 (main.go:11) MOVQ    "".value+16(SP), CX
0x00e4 00228 (main.go:11) MOVQ    CX, (AX)                  // 把要处理的数据写进SP+72所指向的内存, 即堆上
0x00e7 00231 (main.go:12) MOVQ    "".&newValue+72(SP), AX   // 把SP+72里的地址写入AX, 作为入参
0x00ec 00236 (main.go:12) CALL    "".foo(SB)                // 调用foo()
0x00f1 00241 (main.go:12) JMP     243
0x00f3 00243 (main.go:10) MOVQ    ""..autotmp_6+32(SP), CX
0x00f8 00248 (main.go:10) INCQ    CX
0x00fb 00251 (main.go:10) MOVQ    CX, ""..autotmp_6+32(SP)
0x0100 00256 (main.go:10) JMP     170
```

