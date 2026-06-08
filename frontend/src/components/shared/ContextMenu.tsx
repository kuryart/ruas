import { For, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

export interface ContextMenuItem {
	label: string;
	action: () => void;
	danger?: boolean;
}

interface Props {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
}

export default function ContextMenu(props: Props) {
	let menuRef: HTMLDivElement | undefined;

	createEffect(() => {
		const onMouseDown = (e: MouseEvent) => {
			if (menuRef && !menuRef.contains(e.target as Node)) props.onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') props.onClose();
		};
		document.addEventListener('mousedown', onMouseDown);
		document.addEventListener('keydown', onKeyDown);
		onCleanup(() => {
			document.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('keydown', onKeyDown);
		});
	});

	return (
		<Portal>
			<div ref={menuRef} class="ctx-menu" style={{ left: `${props.x}px`, top: `${props.y}px` }}>
				<For each={props.items}>
					{item => (
						<button
							class="ctx-menu-item"
							classList={{ danger: !!item.danger }}
							onMouseDown={e => e.stopPropagation()}
							onClick={() => { item.action(); props.onClose(); }}
						>
							{item.label}
						</button>
					)}
				</For>
			</div>
		</Portal>
	);
}
