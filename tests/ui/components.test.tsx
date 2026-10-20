import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ItemForm } from "../../src/components/ItemForm";
import { TagInput } from "../../src/components/TagInput";
import { SearchOverlay } from "../../src/components/SearchOverlay";
import { ThemeToggle } from "../../src/components/ThemeToggle";
import { EmptyState } from "../../src/components/EmptyState";
import type { Item, ItemWithId } from "../../src/lib/types";

const now = new Date().toISOString();
const fixtureItems: ItemWithId[] = [
  {
    id: "1",
    type: "note",
    title: "Hello note",
    body: "some body text",
    tags: ["inbox"],
    is_favorite: false,
    is_archived: false,
    created_at: now,
    updated_at: now,
    schema_version: 1,
  },
];

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("ItemForm validation per type", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a note and calls onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ItemForm type="note" onSubmit={onSubmit} onCancel={() => {}} />);
    await user.type(screen.getByLabelText("Title"), "My note");
    await user.type(screen.getByLabelText("Body"), "body here");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const item = onSubmit.mock.calls[0][0] as Item;
    expect(item.type).toBe("note");
    expect(item.title).toBe("My note");
  });

  it("rejects invalid URLs without fetching", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ItemForm type="link" onSubmit={onSubmit} onCancel={() => {}} />);
    await user.type(screen.getByLabelText("Title"), "Bad link");
    await user.type(screen.getByLabelText("URL"), "not a url");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid URL");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires a title", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ItemForm type="note" onSubmit={onSubmit} onCancel={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("TagInput", () => {
  it("adds and rejects duplicate tags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} />);
    await user.type(screen.getByPlaceholderText("Add tag..."), "docs");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith(["docs"]);
  });

  it("rejects duplicates against existing tags", async () => {
    const user = userEvent.setup();
    render(<TagInput tags={["docs"]} onChange={() => {}} />);
    await user.type(screen.getByPlaceholderText("Add tag..."), "docs");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/duplicate/i)).toBeInTheDocument();
  });

  it('rejects tags with quotes', async () => {
    const user = userEvent.setup();
    render(<TagInput tags={[]} onChange={() => {}} />);
    await user.type(screen.getByPlaceholderText("Add tag..."), 'a"b');
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/cannot contain/)).toBeInTheDocument();
  });
});

describe("SearchOverlay", () => {
  it("opens on Ctrl+K and closes on Escape", async () => {
    const user = userEvent.setup();
    renderWithRouter(<SearchOverlay items={fixtureItems} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders syntax chips and filters results", async () => {
    const user = userEvent.setup();
    renderWithRouter(<SearchOverlay items={fixtureItems} />);
    await user.keyboard("{Control>}k{/Control}");
    for (const chip of ["type:", "tag:", "is:", "AND"]) {
      expect(screen.getByText(chip)).toBeInTheDocument();
    }
    await user.type(screen.getByRole("combobox"), "hello");
    expect(screen.getByText("Hello note")).toBeInTheDocument();
  });
});

describe("ThemeToggle + EmptyState", () => {
  it("toggles theme and persists", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(localStorage.getItem("pv-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("renders empty state with action", () => {
    render(
      <EmptyState
        title="No items yet"
        description="Create one"
        action={<button>Go</button>}
      />,
    );
    expect(screen.getByText("No items yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Go" }),
    ).toBeInTheDocument();
  });
});
