## Graph 源码

``` python
from typing import TypedDict

from langgraph.graph import StateGraph


class MyState(TypedDict):
    value: str
    name: str

def gen_graph():
    def foo1(state: MyState):
        return {
            "value": state["value"] + state["value"],
        }

    def foo2(state: MyState):
        return {
            "value": state["value"] + state["value"],
        }

    builder = StateGraph(state_schema=MyState)

    builder.add_node("foo1", foo1)
    builder.add_node("foo2", foo2)

    builder.add_edge("foo1", "foo2")

    builder.set_entry_point("foo1")
    graph = builder.compile()

    return graph


if __name__ == "__main__":
    graph = gen_graph()
    print(graph.invoke({"value": "bar"}))
```



## 生成的Graph

见./simple_graph