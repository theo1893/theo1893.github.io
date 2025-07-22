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


OpenManus封装了5个工具集, 其中包含23个等效工具, 并实现了2种工作模式(Non-Flow && Flow), 下面分别记录.



## 工具集

OpenManus提供的工具集默认为5个, 实际等效工具数为23. 在下面分别记录. 

### PythonExecute

#### 定义

入参为code, 为可直接执行的python代码.

```Python
class PythonExecute(BaseTool):
    """A tool for executing Python code with timeout and safety restrictions."""

    name: str = "python_execute"
    description: str = "Executes Python code string. Note: Only print outputs are visible, function return values are not captured. Use print statements to see results."
    parameters: dict = {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "The Python code to execute.",
            },
        },
        "required": ["code"],
    }
```

#### 调用

在本地启动子进程执行, 在timeout内检查进程执行情况.

```Python
with multiprocessing.Manager() as manager:
    result = manager.dict({"observation": "", "success": False})
    if isinstance(__builtins__, dict):
        safe_globals = {"__builtins__": __builtins__}
    else:
        safe_globals = {"__builtins__": __builtins__.__dict__.copy()}
    proc = multiprocessing.Process(
        target=self._run_code, args=(code, result, safe_globals)
    )
    proc.start()
    proc.join(timeout)

    # timeout process
    if proc.is_alive():
        proc.terminate()
        proc.join(1)
        return {
            "observation": f"Execution timeout after {timeout} seconds",
            "success": False,
        }
    return dict(result)
```



### StrReplaceEditor

#### 定义

文件IO使用的工具.

```Python
class StrReplaceEditor(BaseTool):
    """A tool for viewing, creating, and editing files with sandbox support."""

    name: str = "str_replace_editor"
    description: str = _STR_REPLACE_EDITOR_DESCRIPTION
    parameters: dict = {
        "type": "object",
        "properties": {
            "command": {
                "description": "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`, `undo_edit`.",
                "enum": ["view", "create", "str_replace", "insert", "undo_edit"],
                "type": "string",
            },
            "path": {
                "description": "Absolute path to file or directory.",
                "type": "string",
            },
            "file_text": {
                "description": "Required parameter of `create` command, with the content of the file to be created.",
                "type": "string",
            },
            "old_str": {
                "description": "Required parameter of `str_replace` command containing the string in `path` to replace.",
                "type": "string",
            },
            "new_str": {
                "description": "Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.",
                "type": "string",
            },
            "insert_line": {
                "description": "Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.",
                "type": "integer",
            },
            "view_range": {
                "description": "Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.",
                "items": {"type": "integer"},
                "type": "array",
            },
        },
        "required": ["command", "path"],
    }
```

OpenManus的实现通过对命令进行封装和抽象, 实现支持沙盒, 但是原生仅支持**local** docker. 

抽象代码和沙盒默认设置如下:

```Python
## 抽象
@runtime_checkable
class FileOperator(Protocol):
    """Interface for file operations in different environments."""

    async def read_file(self, path: PathLike) -> str:
        """Read content from a file."""
        ...

    async def write_file(self, path: PathLike, content: str) -> None:
        """Write content to a file."""
        ...

    async def is_directory(self, path: PathLike) -> bool:
        """Check if path points to a directory."""
        ...

    async def exists(self, path: PathLike) -> bool:
        """Check if path exists."""
        ...

    async def run_command(
        self, cmd: str, timeout: Optional[float] = 120.0
    ) -> Tuple[int, str, str]:
        """Run a shell command and return (return_code, stdout, stderr)."""
        ...
        
## 沙盒默认设置
class SandboxSettings(BaseModel):
    """Configuration for the execution sandbox"""

    use_sandbox: bool = Field(False, description="Whether to use the sandbox")
    image: str = Field("python:3.12-slim", description="Base image")
    work_dir: str = Field("/workspace", description="Container working directory")
    memory_limit: str = Field("512m", description="Memory limit")
    cpu_limit: float = Field(1.0, description="CPU limit")
    timeout: int = Field(300, description="Default command timeout (seconds)")
    network_enabled: bool = Field(
        False, description="Whether network access is allowed"
    )
```

#### 调用

根据入参command, 调用被细分为5个sub command: **view**, **create**, **str_replace**, **insert**, **undo_edit**

##### view

如果path是目录, 则执行find命令

```Shell
find_cmd = f"find {path} -maxdepth 2 -not -path '*/\\.*'"
```

如果path是文件, 则直接read

##### create

把file_text写进path, 同时append到path中的操作历史list中.

##### str_replace

把path文件里的old_str替换为new_str, 记录操作历史.

##### insert

把new_str插入path文件的指定insert_line处, 记录操作历史.

##### undo_edit

拉取path的操作历史, pop最新的数据, 覆盖到path文件内.



### AskHuman

#### 定义

工具定义如下, 有一个inquire参数

```Python
class AskHuman(BaseTool):
    """Add a tool to ask human for help."""

    name: str = "ask_human"
    description: str = "Use this tool to ask human for help."
    parameters: str = {
        "type": "object",
        "properties": {
            "inquire": {
                "type": "string",
                "description": "The question you want to ask human.",
            }
        },
        "required": ["inquire"],
    }
```

#### 调用

直接调用input方法, 接受用户输入作为result



### Terminate

#### 定义

工具定义如下. Terminate是特殊工具, 在监测到调用之后, 外层循环将执行状态扭转到FINISHED, 在进入下一轮判断时退出.

```Python
class Terminate(BaseTool):
    name: str = "terminate"
    description: str = _TERMINATE_DESCRIPTION
    parameters: dict = {
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "description": "The finish status of the interaction.",
                "enum": ["success", "failure"],
            }
        },
        "required": ["status"],
    }
```

#### 调用

特殊的是工具本身, 工具执行时无特殊逻辑, 直接返回了固定字符串.



### BrowserUseTool

#### 定义

封装了大量浏览器操作的工具, 定义如下.

```Python
class BrowserUseTool(BaseTool, Generic[Context]):
    name: str = "browser_use"
    description: str = _BROWSER_DESCRIPTION
    parameters: dict = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "go_to_url",
                    "click_element",
                    "input_text",
                    "scroll_down",
                    "scroll_up",
                    "scroll_to_text",
                    "send_keys",
                    "get_dropdown_options",
                    "select_dropdown_option",
                    "go_back",
                    "web_search",
                    "wait",
                    "extract_content",
                    "switch_tab",
                    "open_tab",
                    "close_tab",
                ],
                "description": "The browser action to perform",
            },
            "url": {
                "type": "string",
                "description": "URL for 'go_to_url' or 'open_tab' actions",
            },
            "index": {
                "type": "integer",
                "description": "Element index for 'click_element', 'input_text', 'get_dropdown_options', or 'select_dropdown_option' actions",
            },
            "text": {
                "type": "string",
                "description": "Text for 'input_text', 'scroll_to_text', or 'select_dropdown_option' actions",
            },
            "scroll_amount": {
                "type": "integer",
                "description": "Pixels to scroll (positive for down, negative for up) for 'scroll_down' or 'scroll_up' actions",
            },
            "tab_id": {
                "type": "integer",
                "description": "Tab ID for 'switch_tab' action",
            },
            "query": {
                "type": "string",
                "description": "Search query for 'web_search' action",
            },
            "goal": {
                "type": "string",
                "description": "Extraction goal for 'extract_content' action",
            },
            "keys": {
                "type": "string",
                "description": "Keys to send for 'send_keys' action",
            },
            "seconds": {
                "type": "integer",
                "description": "Seconds to wait for 'wait' action",
            },
        },
        "required": ["action"],
        "dependencies": {
            "go_to_url": ["url"],
            "click_element": ["index"],
            "input_text": ["index", "text"],
            "switch_tab": ["tab_id"],
            "open_tab": ["url"],
            "scroll_down": ["scroll_amount"],
            "scroll_up": ["scroll_amount"],
            "scroll_to_text": ["text"],
            "send_keys": ["keys"],
            "get_dropdown_options": ["index"],
            "select_dropdown_option": ["index", "text"],
            "go_back": [],
            "web_search": ["query"],
            "wait": ["seconds"],
            "extract_content": ["goal"],
        },
    }
```

其浏览器实例使用browser_use库的**有头**游览器**BrowserUseBrowser**, 但实际仅使用到其中的playwright部分, 不涉及ai集成的部分.

#### 调用

根据入参action的不同, 划分为16个sub command

##### go_to_url

获取当前page, 跳转到指定url并等待响应.

##### click_element

触发指定index的dom元素的点击事件.

##### input_text

在指定index的dom元素输入text.

##### scroll_down / scroll_up

执行js代码, 向指定方向滚动多少个像素.

```JavaScript
window.scrollBy(0, ...)
```

##### scroll_to_text

滚动到指定text.

##### send_keys

在当前page输入指定的键盘事件.

##### get_dropdown_options

获取指定index的dom元素的下拉列表, 通过js执行.

```JavaScript
(xpath) => {
    const select = document.evaluate(xpath, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!select) return null;
    return Array.from(select.options).map(opt => ({
        text: opt.text,
        value: opt.value,
        index: opt.index
    }));
}
```

##### select_dropdown_option

在指定index的dom元素中, 选中指定text的那个选项.

##### go_back

当前page回退.

##### wait

等几秒.

##### switch_tab

切到指定tab_id的tab.

##### open_tab

使用指定url打开一个新tab.

##### close_tab

关闭当前tab.

##### extract_content

把当前页面的所有内容转换给md, 然后调用1次llm, 提取指定goal的内容.

这里OpenManus的实现方式是定义1个tool, tool包含必要参数**extracted_content**, 同时强制tool call >= 1, 因此实际所需的内容是返回的tool arg.

##### web_search

这里做了一层封装, 下面封了4个搜索引擎: Google, Baidu, DuckDuckGo, BingSearch.

调用web_search时, tool按顺序使用不同引擎对参数query进行搜索, 成功后返回, 同时当前页面跳转到第一条搜索结果的url.

![img](web_search.excalidraw.svg)



## Non-Flow模式

在Non-Flow模式下, 仅存在1个名为Manus的Agent, 执行流程如下图

![img](non_flow_graph.excalidraw.svg)

### Step Limit

默认为20. 超过后强制结束任务.



## Flow模式

在Non-Flow模式中, 单个任务在N轮Think-Act循环后被处理完成, Flow模式则是在这一流程上做了一层封装: 入口处增加Planning步骤.

Planning会分析用户输入的任务, 预先生成多个**子任务**, 然后将每个子任务单独送进Non-Flow的流程图中. 当所有子任务完成后, 返回最终的任务结果.

Flow模式的执行流程如下图所示:

![img](flow_graph.excalidraw.svg)



### Planning如何划分子任务

在Flow模式下, OpenManus使用一个名为planning的Tool来进行子任务划分. 其部分结构定义如下:

```Python
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



### Step Limit

在OpenManus的实现中, N个子任务顺序被送进同一个Manus Agent对象, 这个Agent的执行轮数**递增**.

即在Flow模式下, 实际执行的步数仍然受限于Manus Agent的step limit, 默认是25.



## 浏览器上下文

BrowserUse工具使用browser-use库和浏览器直接交互. 如果一个任务涉及到浏览器操作, 那么很有可能出现下面这种情况: 

**单次浏览器操作无法完成此任务**.

举例来说, 如果任务的描述为"对XX大学计算机专业进行查询", 那么为了完成这个子任务, 一种可能的操作顺序为:

-  Google搜索相关内容;
-  进入XX大学官网;
-  滚轮向下滚动500px;
-  点击计算机科学与技术学院的链接;
-  提取当前页面内容;

从上面的例子可以看出, 浏览器行为被细化成了5个步骤, 并且每个步骤和前一个步骤存在高度的关联. 

OpenManus通过下面的方式实现这种行为:

在Think阶段, 如果发现上一轮涉及到浏览器操作, 则将上一轮浏览器的**数据快照**写入prompt, 用于指导这一轮的行为. 具体而言, 这里使用的prompt模板如下:

```SQL
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



## 上下文压缩

OpenManus没有上下文压缩, 只是通过简单地丢弃早期的message来保证消息列表的长度不过长.

默认是保存近期100条消息.
