---
title: Golang杂项 Excel内容组织结构
date: 2024-08-24 14:29:17
categories:
- Tech
tags:
- golang
- excel

---

# Excel内容组织结构

**Excel文件本身是zip文件**, 可以通过直接解压得到内部的数据.

![](unzip_excel.png)

## 文件结构

如下图所示, 下面针对部分重要文件介绍.

![](tree.png)

### xl/sharedStrings.xml

这个文件存储了Excel中的部分高频字符串, 用以压缩文件大小.

![](ss.png)

### xml/styles.xml

这个文件存储了Excel中使用到的样式定义, 主要关注**cellXfs**字段即可.

![](styles.png)

### xl/worksheets/sheet2.xml

存储sheet2的数据, 格式如下图所示.

![](sheet.png)

### 行语法

以下面这一行定义为例.

```xml
<row r="1", ht="15.75", span="1:6", customHeight="1" x14ac:dyDescent="0.2">
```

r: 行数

ht: 行高

spans: 行内列的数量

其余字段不知.

### 列语法

以下面这个cell为例.

```xml
<c r="D2" s="2" t="s">
    <v>4</v>
</c>
```

r: cell的坐标

s: cell使用的style的索引, 需要在style文件中的cellXfs进行取值

t: 数据类型, 含义如下

​        s: 类型为shared string, 这里的值为索引, 需要在sharedStrings.xml文件中进行取值

​        inlineStr: 内联字符串

​        b: bool值

​        e: error

​        str: 原生字符串, 直接填充在cell这里

​        d: 日期

​        n: 数值类型

​        空: 默认数值类型

## Golang相关补充

不同excel库解析同一个excel文件的逻辑不同, 以下面这个cell为例.

```xml
<c r="D5" s="2">
    <v>-15.299999999999999</v>
</c>
```

### excelize@v2.6.0

对数值类型, 会进行2次处理:

S1. 使用big.Float解析为float64.

S2. 使用指定的style进行一次格式化.

在S1中, 由于-15.299999999999999已经超过了float64能表示的最大精度范围, 丢失了精度, 解析得到-19.4

### xlsx@v1.0.5, xlsx/v3@v3.3.5

直接提取xml中的原始字符串, 即解析为-15.299999999999999
