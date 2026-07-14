export interface ShadowChange<TSnapshot = unknown> {
	id: string;
	type: string;
	label: string;
	before: TSnapshot;
	after: TSnapshot;
	payload?: unknown;
}

type Listener<TSnapshot> = (change: ShadowChange<TSnapshot>, snapshot: TSnapshot) => void;

export abstract class ShadowModelBase<TSnapshot> {
	private readonly listeners = new Set<Listener<TSnapshot>>();
	private readonly initialSnapshot: TSnapshot;
	private readonly changes: ShadowChange<TSnapshot>[] = [];

	protected constructor(initialSnapshot: TSnapshot) {
		this.initialSnapshot = this.clone(initialSnapshot);
	}

	abstract snapshot(): TSnapshot;

	onChange(listener: Listener<TSnapshot>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	changeLog(): ShadowChange<TSnapshot>[] {
		return [...this.changes];
	}

	initial(): TSnapshot {
		return this.clone(this.initialSnapshot);
	}

	isDirty(): boolean {
		return this.changes.length > 0;
	}

	protected emit(type: string, label: string, before: TSnapshot, payload?: unknown): void {
		const after = this.snapshot();
		const change: ShadowChange<TSnapshot> = {
			id: `${Date.now().toString(36)}-${this.changes.length + 1}`,
			type,
			label,
			before: this.clone(before),
			after: this.clone(after),
			payload,
		};
		this.changes.push(change);
		for (const listener of this.listeners) listener(change, this.clone(after));
	}

	protected capture(): TSnapshot {
		return this.snapshot();
	}

	protected clone<T>(value: T): T {
		return JSON.parse(JSON.stringify(value));
	}
}
