"""Version 2 portable document. No account secrets or partner todos here."""
import re
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Slot(Strict):
    id: str = Field(min_length=1, max_length=80)
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    kind: str | None = None
    label: str | None = Field(default=None, max_length=12)


class Course(Strict):
    id: str = Field(min_length=1, max_length=80)
    day: int = Field(ge=1, le=7)
    start: str
    end: str
    name: str = Field(min_length=1, max_length=30)
    room: str = Field(max_length=60)
    note: str = Field(max_length=500)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class Todo(Strict):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=80)
    dueAt: int = Field(ge=0, le=8640000000000000)
    createdAt: int = Field(ge=0, le=8640000000000000)
    priority: str = Field(pattern=r"^(low|normal|high)$")
    note: str = Field(max_length=500)
    completed: bool
    remind: bool
    alarmEnabled: bool = False
    alarmAt: int = Field(default=0, ge=0, le=8640000000000000)

    @model_validator(mode="after")
    def valid_alarm(self):
        if self.alarmEnabled and not self.alarmAt:
            raise ValueError("alarm time required")
        return self


class Document(Strict):
    version: int = Field(ge=2, le=2)
    slots: list[Slot] = Field(min_length=1, max_length=24)
    courses: list[Course] = Field(max_length=400)
    todos: list[Todo] = Field(max_length=500)

    @model_validator(mode="after")
    def valid_schedule(self):
        ids = [s.id for s in self.slots]
        if len(set(ids)) != len(ids) or not any(s.kind is None for s in self.slots):
            raise ValueError("invalid slots")
        last = "00:00"
        for s in self.slots:
            if s.start < last or s.start >= s.end or s.kind not in (None, "activity"):
                raise ValueError("overlapping or invalid slots")
            if s.kind == "activity" and not (s.label and s.label.strip()):
                raise ValueError("activity label required")
            last = s.end
        used = set()
        for c in self.courses:
            if not c.name.strip() or c.start not in ids or c.end not in ids:
                raise ValueError("invalid course")
            a, b = ids.index(c.start), ids.index(c.end)
            if b < a or self.slots[a].kind or self.slots[b].kind:
                raise ValueError("invalid course span")
            for i in range(a, b + 1):
                if self.slots[i].kind:
                    continue
                if (c.day, i) in used:
                    raise ValueError("overlapping courses")
                used.add((c.day, i))
        for items in (self.courses, self.todos):
            if len({x.id for x in items}) != len(items):
                raise ValueError("duplicate IDs")
        if any(not t.title.strip() for t in self.todos):
            raise ValueError("empty todo title")
        return self


class Credentials(Strict):
    username: str = Field(pattern=r"^[a-zA-Z0-9_]{3,32}$")
    password: str = Field(min_length=10, max_length=128)


class Registration(Credentials):
    nickname: str = Field(min_length=1, max_length=30)


class Refresh(Strict):
    refreshToken: str = Field(min_length=20, max_length=200)


class PutData(Strict):
    baseRevision: int = Field(ge=0)
    document: Document


class Invite(Strict):
    userId: str = Field(pattern=r"^[a-f0-9]{12}$")


class Decision(Strict):
    action: str = Field(pattern=r"^(accept|reject|withdraw)$")
