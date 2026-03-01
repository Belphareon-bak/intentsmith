// Python FastAPI Scaffold (v90)
// ══════════════════════════════════════════════════════════════════════════════

export const pythonFastapiScaffold = {
  id: 'python-fastapi',
  name: 'FastAPI REST API',
  description: 'Python FastAPI REST API with Pydantic models, CORS, and uvicorn',
  tags: ['python', 'fastapi', 'api', 'rest'],
  stack: ['Python', 'FastAPI', 'Pydantic', 'uvicorn'],
  complexity: 'SIMPLE',

  files: [
    {
      path: 'requirements.txt',
      type: 'config',
      template: `fastapi>=0.109.0
uvicorn[standard]>=0.27.0
pydantic>=2.5.0`,
    },
    {
      path: 'main.py',
      type: 'code',
      template: `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import router

app = FastAPI(
    title="{{PROJECT_NAME}}",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}`,
    },
    {
      path: 'app/__init__.py',
      type: 'code',
      template: ``,
    },
    {
      path: 'app/models.py',
      type: 'code',
      template: `from pydantic import BaseModel


class ItemCreate(BaseModel):
    name: str
    description: str | None = None


class Item(ItemCreate):
    id: int

    class Config:
        from_attributes = True`,
    },
    {
      path: 'app/routes.py',
      type: 'code',
      template: `from fastapi import APIRouter, HTTPException
from app.models import Item, ItemCreate

router = APIRouter()

# In-memory store (replace with DB in production)
_items: dict[int, Item] = {}
_next_id = 1


@router.get("/items", response_model=list[Item])
def list_items():
    return list(_items.values())


@router.get("/items/{item_id}", response_model=Item)
def get_item(item_id: int):
    if item_id not in _items:
        raise HTTPException(status_code=404, detail="Item not found")
    return _items[item_id]


@router.post("/items", response_model=Item, status_code=201)
def create_item(data: ItemCreate):
    global _next_id
    item = Item(id=_next_id, **data.model_dump())
    _items[_next_id] = item
    _next_id += 1
    return item


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    if item_id not in _items:
        raise HTTPException(status_code=404, detail="Item not found")
    del _items[item_id]`,
    },
  ],

  postSetup: [
    'pip install -r requirements.txt',
    'uvicorn main:app --reload',
  ],
};
