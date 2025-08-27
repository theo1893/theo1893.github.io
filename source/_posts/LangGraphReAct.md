---
title: LangGraph学习笔记(7) ReAct模型
categories:
  - Tech
tags:
  - LangGraph
  - Agent
date: 2025-08-27 19:29:53
---



# LangGraph ReAct模型

[ReAct](https://arxiv.org/pdf/2210.03629)是2023年被提出的设计, 为LLM引入了反思机制, 用以提高最终的表现. ReAct机制由2个步骤组成: Reasoning 和 Acting. 在Reasoning阶段, LLM根据当前可用的工具集, 判断是否需要进行Acting; 在Acting阶段, LLM使用指定的工具进行一步操作, 然后将控制权再次交给Reasoning, 进行下一轮判断. 而在这2个步骤之前, ReAct模型还需要进行一些初始化的工作.

本章会基于下面这一段代码, 从LangGraph内部实现细节介绍ReAct模型.

``` python
from langgraph.prebuilt import create_react_agent


def add(a: float, b: float):
    """Add two numbers."""
    return a + b


def multiply(a: float, b: float):
    """Multiply two numbers."""
    return a * b


def divide(a: float, b: float):
    """Divide two numbers."""
    return a / b


math_agent = create_react_agent(
    model="openai:gpt-4.1",
    tools=[add, multiply, divide],
    prompt=(
        "You are a math agent.\n\n"
        "INSTRUCTIONS:\n"
        "- Assist ONLY with math-related tasks\n"
        "- After you're done with your tasks, respond to the supervisor directly\n"
        "- Respond ONLY with the results of your work, do NOT include ANY other text."
    ),
    name="math_agent",
)


for chunk in math_agent.stream({"messages": [{"role": "user", "content": "Calculate 1+1"}]}):
    print(chunk)
```



## ToolNode(Acting)

在LangGraph的实现中, Tool对象是对可执行工具的基本封装, 每个Tool对应着一个工具. 而ToolNode是由多个Tool组成的工具集结点, 对应着一个Pregel结点, 对应ReAct模型中的Acting对象. 

在初始化流程中, LangGraph首先将用户指定的多个可执行对象分别封装为单独的StructuredTool对象, 其核心定义如下:

``` python
class StructuredTool(BaseTool):
    ......
    
    description: str = ""	## 工具描述. 默认使用func的docstring.
    args_schema: Annotated[ArgsSchema, SkipValidation()] = Field(
        ..., description="The tool schema."
    )	## 工具参数, 由func的签名推导得出.
    func: Optional[Callable[..., Any]] = None	## 实际的可执行对象.
    
    ......
```

而ToolNode就是Tool的集合, 其包含了用户指定的所有Tool. 以上面的代码为例, LangGraph在初始化阶段会生成3个StructuredTool, 分别对应add, divide, multiply方法, 然后创建一个ToolNode对象, 包含这里的3个Tool. 

### 执行

由于ToolNode属于Pregel节点, 按照之前章节的介绍, ToolNode需要处理Pregel输入并返回处理的结果.

ToolNode的执行流程图如下图所示:  ToolNode接受上游节点传过来的tool calls, 将每个tool call单独提交给全局线程池, 最后等待全部执行完成后, 将tool result构造为ToolMessage, 重新发布到**messages**通道.

由于在这个例子中, 仅产生了1次tool call, 因此ToolNode仅向**messages**通道发布了一条ToolMessage.

![](tool_node.svg)

另外需要注意的一个实现细节是, 在LangGraph的实现中, 每个tool call会被单独送到ToolNode, 但这并不影响最终的并发执行, 这里仅作为记录.



## AgentNode(Reasoning)

LangGraph默认提供了Reasoning对象的封装, 这里我们称其为AgentNode. 

AgentNode主要行为有2个: 使用当前messages列表调用llm; 根据llm返回以及当前状态, 判断是否终止执行. 其核心代码如下:

``` python
def call_model(
    state: StateSchema, runtime: Runtime[ContextT], config: RunnableConfig
) -> StateSchema:
    if is_async_dynamic_model:
        msg = (
            "Async model callable provided but agent invoked synchronously. "
            "Use agent.ainvoke() or agent.astream(), or "
            "provide a sync model callable."
        )
        raise RuntimeError(msg)

    model_input = _get_model_input_state(state)

    if is_dynamic_model:
        # Resolve dynamic model at runtime and apply prompt
        dynamic_model = _resolve_model(state, runtime)
        response = cast(AIMessage, dynamic_model.invoke(model_input, config))  # type: ignore[arg-type]
    else:
        ## 调用llm获取response
        response = cast(AIMessage, static_model.invoke(model_input, config))  # type: ignore[union-attr]

    response.name = name

    ## 判断是否需要终止执行: 如果返回为True, 则终止执行, 告知用户轮数上限不够
    if _are_more_steps_needed(state, response):
        return {
            "messages": [
                AIMessage(
                    id=response.id,
                    content="Sorry, need more steps to process this request.",
                )
            ]
        }
    # We return a list, because this will get added to the existing list
    return {"messages": [response]}
```

其中_are_more_steps_needed 方法用于判断剩余可用轮数是否足够, 其核心判断逻辑为: 如果当前可用轮数<2 并且 response仍然存在tool call, 则返回为True.

AgentNode的执行图例如下图所示, 需要注意的是, 默认轮数上限为25.

![](agent_node.svg)



## 条件路由 should_continue

在上面的代码中我们提到, AgentNode在可用轮数不足的情况下, 会终止执行, 但是这个操作是怎么进行的呢?

在实现中, LangGraph在AgentNode和ToolNode之间牵了一条conditional edge, 路由函数如下所示:

``` python
    def should_continue(state: StateSchema) -> Union[str, list[Send]]:
        messages = _get_state_value(state, "messages")
        last_message = messages[-1]

        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            if post_model_hook is not None:
                return "post_model_hook"
            elif response_format is not None:
                return "generate_structured_response"
            else:
                ## 如果最新的一条llm响应不包含tool calls, 则路由到END
                return END
        else:
            if version == "v1":
                return "tools"
            elif version == "v2":
                if post_model_hook is not None:
                    return "post_model_hook"
                ## 使用最新的一条llm响应, 构造实际可执行的tool call
                tool_calls = [
                    tool_node.inject_tool_args(call, state, store)  # type: ignore[arg-type]
                    for call in last_message.tool_calls
                ]
                ## 使用[Send]将tool call发送到下游的ToolNode
                return [Send("tools", [tool_call]) for tool_call in tool_calls]
```

从这段代码我们能看到, **如果最新的一条llm响应不包含tool calls, 则执行权会被路由到END**. 而在AgentNode执行中, 当推理判断为需要终止时, 会产生一条固定的纯文本message追加到messages通道, 此时should_continue会将执行权路由到END, 从而终止执行.

在需要继续执行的场景下, should_continue对每个tool call构造一个单独的Send对象路由到ToolNode. 具体执行图例如下:

![](router.svg)



## 整体Pregel图

基于上述的介绍, LangGraph提供的ReAct模型的整体Pregel图示如下:

![](pregel_overview.svg)

