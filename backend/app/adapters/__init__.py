from app.adapters.base import BaseAdapter
from app.adapters.doc_great_walk import DocGreatWalkAdapter
# from app.adapters.doc_standard_hut import DocStandardHutAdapter

_REGISTRY: dict[str, type[BaseAdapter]] = {
    DocGreatWalkAdapter.adapter_id: DocGreatWalkAdapter,
    # DocStandardHutAdapter.adapter_id: DocStandardHutAdapter,
}

def get_adapter(adapter_id: str) -> BaseAdapter:
    cls = _REGISTRY.get(adapter_id)
    if not cls:
        raise ValueError(f"Unknown adapter: {adapter_id}. Available: {list(_REGISTRY.keys())}")
    return cls()

def list_adapters() -> list[dict]:
    return [
        {
            "adapter_id": cls.adapter_id,
            "name": cls.name,
            "param_fields": [f.__dict__ for f in cls.param_fields()],
        }
        for cls in _REGISTRY.values()
    ]