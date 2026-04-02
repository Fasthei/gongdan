"""
LangGraph agent graph for KB Chat.
Uses Azure OpenAI via langchain-openai.
"""
import os
from typing import Annotated

from langchain_core.messages import BaseMessage
from langchain_openai import AzureChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver
from typing_extensions import TypedDict


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def build_graph() -> tuple[any, MemorySaver]:
    llm = AzureChatOpenAI(
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2025-04-01-preview"),
        azure_deployment=os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5.4"),
        temperature=0.3,
        streaming=True,
    )

    def call_model(state: State):
        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    builder = StateGraph(State)
    builder.add_node("agent", call_model)
    builder.set_entry_point("agent")
    builder.add_edge("agent", END)

    checkpointer = MemorySaver()
    graph = builder.compile(checkpointer=checkpointer)
    return graph, checkpointer
