---
title: OpenManus学习笔记
categories:
  - Tech
tags:
  - Agent
date: 2025-07-15 20:23:51
---


# OpenManus学习笔记

此文档用作记录OpenManus的学习笔记, OpenManus[原始仓库](https://github.com/FoundationAgents/OpenManus).

> **工具使用，是人类区别于动物的标志 —— 也是 Agent 区别于大模型的标志。**
>
> **工具使用，是大模型连接现实世界的桥梁，使 Agent 能够接触本地或远程资源。**
>
> **OpenManus 的目的在于打造一个极简且通用的 Agent 框架，其核心是可插拔的 Tools 和预定义 Prompt 的组合。**在 OpenManus 中，Prompt 控制了 Agent 的行为逻辑，Tools 定义了 Agent 的动作空间，二者结合就能完整诠释一个 ReAct Agent。
>
> 作者：mannaandpoem
> 链接：https://www.zhihu.com/question/14321968965/answer/119354825165
> 来源：知乎
> 著作权归作者所有。商业转载请联系作者获得授权，非商业转载请注明出处。



OpenManus是遵循ReAct设计Single Agent, 核心操作由Think和Act构成. Think流程负责控制本轮次需要使用的Tools; Act流程负责执行Tools.


OpenManus提供2种工作模式: Non-Flow和Flow. 下面分别对2种工作模式进行记录.

## Non-Flow模式

在Non-Flow模式下, 仅存在1个名为Manus的Agent, 其默认携带5个Tool, 分别为:

1. PythonExecute, 用作执行python代码;
2. BrowserUse, 用作直接和浏览器交互, 依赖项目[browser-use](https://github.com/browser-use/browser-use);
3. StrEditor, 用作处理字符串操作, 并负责部分文件IO;
4. AskHuman, 用作和用户交互;
5. Terminate, 用作退出执行;



执行流程如下图所示:



![](non_flow_graph.excalidraw.svg)

## Flow模式

在Non-Flow模式中, 单个任务在N轮Think-Act循环后被处理完成, Flow模式则是在这一流程上做了一层封装: 入口处增加Planning步骤.

Planning会分析用户输入的任务, 预先生成多个**子任务**, 然后将每个子任务单独送进Non-Flow的流程图中. 当所有子任务完成后, 返回最终的任务结果.

Flow模式的执行流程如下图所示:

![](flow_graph.excalidraw.svg)

### Planning如何划分子任务

OpenManus使用一个名为planning的Tool来进行子任务划分. 其部分结构定义如下:
``` python
class PlanningTool(BaseTool):
    """
    A planning tool that allows the agent to create and manage plans for solving complex tasks.
    The tool provides functionality for creating plans, updating plan steps, and tracking progress.
    """

    name: str = "planning"
    description: str = _PLANNING_TOOL_DESCRIPTION
    parameters: dict = {
        "type": "object",
        "properties": {
            "command": {
                "description": "The command to execute. Available commands: create, update, list, get, set_active, mark_step, delete.",
                "enum": [
                    "create",
                    "update",
                    "list",
                    "get",
                    "set_active",
                    "mark_step",
                    "delete",
                ],
                "type": "string",
            },
          ......
            "steps": {
                "description": "List of plan steps. Required for create command, optional for update command.",
                "type": "array",
                "items": {"type": "string"},
            },
          ......
        },
        "required": ["command"],
        "additionalProperties": False,
    }
```

OpenManus将这个Tool交给llm生成调用参数, 而llm生成create调用时, 必须要给出**steps**参数. 

这里的**steps**, 即为llm拆分出的子任务.



### Manus Agent中的step limit, 在Flow模式下如何计算

在OpenManus的实现中, N个子任务顺序被送进同一个Manus Agent对象, 这个Agent的执行轮数**递增**.

即在Flow模式下, 实际执行的步数仍然受限于Manus Agent的step limit.



## 2个特殊Tool

在Manus Agent预定义的5个Tool里, BrowserUse和Terminate比较特殊, 下面单独介绍.

### BrowserUse

BrowserUse工具使用browser-use库和浏览器直接交互. 如果一个子任务涉及到浏览器操作, 那么很有可能出现下面这种情况: 

**单次浏览器操作无法完成此子任务**.

举例来说, 如果子任务的描述为"对XX大学计算机专业进行查询", 那么为了完成这个子任务, 一种可能的操作顺序为:

- [ ] Google搜索相关内容;
- [ ] 进入XX大学官网;
- [ ] 滚轮向下滚动500px;
- [ ] 点击计算机科学与技术学院的链接;
- [ ] 提取当前页面内容;

从上面的例子可以看出, 浏览器行为被细化成了5个步骤, 并且每个步骤和前一个步骤存在高度的关联. 

OpenManus通过下面的方式实现这种行为:

在Think阶段, 如果发现上一轮涉及到浏览器操作, 则将上一轮浏览器的**数据快照**写入prompt, 用于指导这一轮的行为. 具体而言, 这里使用的prompt模板如下:

``` python
What should I do next to achieve my goal?

When you see [Current state starts here], focus on the following:
- Current URL and page title{url_placeholder}
- Available tabs{tabs_placeholder}
- Interactive elements and their indices
- Content above{content_above_placeholder} or below{content_below_placeholder} the viewport (if indicated)
- Any action results or errors{results_placeholder}

For browser interactions:
- To navigate: browser_use with action="go_to_url", url="..."
- To click: browser_use with action="click_element", index=N
- To type: browser_use with action="input_text", index=N, text="..."
- To extract: browser_use with action="extract_content", goal="..."
- To scroll: browser_use with action="scroll_down" or "scroll_up"

Consider both what's visible and what might be beyond the current viewport.
Be methodical - remember your progress and what you've learned so far.

If you want to stop the interaction at any point, use the `terminate` tool/function call.
```

这里涉及到了当前url, 打开的tabs, 视图偏移等数据, 用来表示当前浏览器的状态.



### Terminate

OpenManus将正常的终止操作封装成一个Tool, 交给llm来调用. Terminate调用完成后, 会将Manus Agent的状态扭转为IDLE, 进而退出执行循环, 视作完成一个子任务.
