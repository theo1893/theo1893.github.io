---
title: LangGraph学习笔记(2) Pregel通道
categories:
  - Tech
tags:
  - LangGraph
  - Agent
---

# Pregel 通道(Channel)

Pregel使用Channel作为节点间通信的路径. Channel在第N轮Super Step执行时, 从第N轮被激活的节点处获取数据, 并在第N+1轮Super Step执行时, 将数据推到第N+1轮被激活的节点.

在具体实现中, Channel是一个抽象类, 其部分方法定义如下:

``` python
class BaseChannel(Generic[Value, Update, C], ABC):
    """Base class for all channels."""
    
    ......
    
    @abstractmethod
    def get(self) -> Value:
        """读取当前通道内数据"""

    def is_available(self) -> bool:
        """判断当前通道是否available. 子类会有自己特殊的实现"""
        try:
            self.get()
            return True
        except EmptyChannelError:
            return False
          
    @abstractmethod
    def update(self, values: Sequence[Update]) -> bool:
        """在本轮Super Stop通道收到节点发布的数据(由于多个节点可以对同一个通道发布, 入参为list), 对自身的数据进行更新"""

    ......
```



LangGraph(v0.5.2)默认提供了7种Channel, 下面分别进行介绍.



## AnyValue

AnyValue实现了存储最新的数据. 部分代码片段如下:

``` python
class AnyValue(Generic[Value], BaseChannel[Value, Value, Value]):
    """Stores the last value received, assumes that if multiple values are
    received, they are all equal."""
    
    """仅存储最新的那条数据"""
    def update(self, values: Sequence[Value]) -> bool:
        if len(values) == 0:
            if self.value is MISSING:
                return False
            else:
                self.value = MISSING
                return True

        self.value = values[-1]
        return True

    def get(self) -> Value:
        if self.value is MISSING:
            raise EmptyChannelError()
        return self.value

    def is_available(self) -> bool:
        return self.value is not MISSING
```

数据流如下图:

![](any_value.svg)



## LastValue

LastValue和AnyValue类似, 仅存储最新的数据. 不同之处在于, LastValue仅支持单个元素的输入. 部分代码片段如下:

``` python
class LastValue(Generic[Value], BaseChannel[Value, Value, Value]):
    """Stores the last value received, can receive at most one value per step."""
    
    """如果要更新, 那么values只能长度为1"""
    def update(self, values: Sequence[Value]) -> bool:
        if len(values) == 0:
            return False
        if len(values) != 1:
            msg = create_error_message(
                message=f"At key '{self.key}': Can receive only one value per step. Use an Annotated key to handle multiple values.",
                error_code=ErrorCode.INVALID_CONCURRENT_GRAPH_UPDATE,
            )
            raise InvalidUpdateError(msg)

        self.value = values[-1]
        return True

    def get(self) -> Value:
        if self.value is MISSING:
            raise EmptyChannelError()
        return self.value
```

数据流如下图:

![](last_value.svg)



## EphemeralValue

和AnyValue类型没有本质区别, 然而库中多使用EphemeralValue, 大概是因为命名更具辨识性.

不做额外介绍.



## BinaryOperatorAggregate

BinaryOperatorAggregate实现了对数据进行聚合. 

在初始化时, BinaryOperatorAggregate需要接收一个**二元操作符**, 在接受到更新的数据列表时, 会使用此二元操作符, 将更新的数据列表聚合为1个元素, 然后进行存储.

部分代码如下:

``` python
class BinaryOperatorAggregate(Generic[Value], BaseChannel[Value, Value, Value]):
    """Stores the result of applying a binary operator to the current value and each new value."""
    
    """接收本轮Super Step产生的新数据, 迭代将其聚合为1个元素"""
    def update(self, values: Sequence[Value]) -> bool:
        if not values:
            return False
        if self.value is MISSING:
            self.value = values[0]
            values = values[1:]
        for value in values:
          	## 调用二元操作符, 迭代处理元素
            self.value = self.operator(self.value, value)
        return True

    def get(self) -> Value:
        if self.value is MISSING:
            raise EmptyChannelError()
        return self.value
```

数据流如下图:

![](bo_op.svg)



## NamedBarrierValue

NamedBarrierValue实现了一种同步拦截机制: 

此通道在初始化时需要指定一组names, 仅接收在这些name产生的更新, 并且仅当这一组names上**全部**产生新的数据后, 此通道才会被标记为available.

部分代码如下:

``` python
class NamedBarrierValue(Generic[Value], BaseChannel[Value, Value, set[Value]]):
    """A channel that waits until all named values are received before making the value available."""
    
    ## 初始化时指定接受的names
    def __init__(self, typ: type[Value], names: set[Value]) -> None:
        super().__init__(typ)
        self.names = names
        self.seen: set[str] = set()
        
    def update(self, values: Sequence[Value]) -> bool:
        updated = False
        ## 仅接收names中发生的更新
        for value in values:
            if value in self.names:
                if value not in self.seen:
                  	## 标记此value已经见过
                    self.seen.add(value)
                    updated = True
            else:
                raise InvalidUpdateError(
                    f"At key '{self.key}': Value {value} not in {self.names}"
                )
        return updated

    def get(self) -> Value:
      	## 仅当names全部发生更新后, 才正常返回
        if self.seen != self.names:
            raise EmptyChannelError()
        return None

    def is_available(self) -> bool:
      	## 同上, 仅当names全部发生更新后, 才被标记为available
        return self.seen == self.names

    def consume(self) -> bool:
        if self.seen == self.names:
            self.seen = set()
            return True
        return False
```

数据流如下图:

![](barrier.svg)



## Topic

Topic**默认**使用本轮更新的数据替换掉通道内当前存储的数据, 并在读取时返回全部的存储数据.

部分代码如下:

``` python
class Topic(
    Generic[Value],
    BaseChannel[Sequence[Value], Union[Value, list[Value]], list[Value]],
):
    """A configurable PubSub Topic.

    Args:
        typ: The type of the value stored in the channel.
        accumulate: Whether to accumulate values across steps. If False, the channel will be emptied after each step.
    """
    
    def update(self, values: Sequence[Value | list[Value]]) -> bool:
        updated = False
        ## 默认为false, 不进行累加
        if not self.accumulate:
            updated = bool(self.values)
            self.values = list[Value]()
        ## 将values展平后替换当前存储
        if flat_values := tuple(flatten(values)):
            updated = True
            self.values.extend(flat_values)
        return updated

    ## 返回当前全部数据
    def get(self) -> Sequence[Value]:
        if self.values:
            return list(self.values)
        else:
            raise EmptyChannelError

    def is_available(self) -> bool:
        return bool(self.values)
```

在当前的设计中(LangGraph v0.5.2), Topic仅被用作传递pregel task的内存队列使用.



## UntrackedValue

当前版本没有用到, 不进行记录.
