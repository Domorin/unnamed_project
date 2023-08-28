import { useModal } from "@/react/hooks/use_modal";
import { RouterOutput } from "@/server/routers/_app";
import { WSTypes, YJS } from "@notecraft/common";
import { Editor as CoreEditor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { EditorContent, useEditor } from "@tiptap/react";
import { ComponentProps, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Cursor } from "./cursor";
import { EditorBubbleMenu } from "./editor_bubble_menu";
import { EditorLinkTooltip } from "./editor_link_tooltip";
import { AutocompleteCommandsList } from "./extensions/autocomplete/autocomplete_commands_list";
import Commands from "./extensions/autocomplete/autocomplete_extension";
import getSuggestionItems from "./extensions/autocomplete/autocomplete_items";
import { createRenderItems } from "./extensions/autocomplete/autocomplete_render_items";
import { baseExtensions } from "./extensions/base_extensions";
import { CustomLink } from "./extensions/custom_link_mark";
import { createHoverExtension } from "./extensions/hover_extension";
import { StaticNote } from "./static_page";

export function getCurrentMark(editor: CoreEditor, name: "customLink") {
	if (!editor.isActive(name)) {
		return;
	}

	const selection = editor.state.selection;

	const node = editor.state.doc.nodeAt(selection.to);

	return node?.marks.find((val) => val.type.name === name);
}

export function WysiwygEditor(props: {
	slug: string;
	provider: YJS.CustomProvider;
	presences: WSTypes.UserPresence[];
	metadata: RouterOutput["note"]["metadata"];
}) {
	const ref = useRef(props.presences);
	const { openModal } = useModal("EditorLinkInput");

	const [isEditorReady, setIsEditorReady] = useState(false);

	const [hoveredLinkDom, setHoveredLink] = useState<HTMLAnchorElement | null>(
		null
	);

	const [commandAutocompleteMenuProps, setShowingAutocomplete] =
		useState<ComponentProps<typeof AutocompleteCommandsList> | null>(null);

	const toggleModal = useCallback(
		(editor: CoreEditor, opts: { href: string; title: string }) => {
			openModal({
				initialHref: opts.href,
				initialTitle: opts.title,
				onSubmit: editor.commands.setCustomLink,
				onRemove: editor.commands.unsetCustomLink,
			});
		},
		[openModal]
	);

	if (props.presences !== ref.current) {
		ref.current = props.presences;
	}

	const editor = useEditor({
		onCreate: ({ editor }) => {
			setIsEditorReady(true);
			editor.setEditable(
				props.metadata.allowAnyoneToEdit ||
					props.metadata.isCreatedByYou
			);
		},
		extensions: [
			...baseExtensions,
			Collaboration.configure({
				document: props.provider.doc,
			}),
			CollaborationCursor.configure({
				provider: props.provider,
				user: {
					id: props.provider.doc.clientID,
				},
				render: (user: { id: string }) => {
					const presences = ref.current;

					const userId = user.id;
					const presence = presences.find(
						(val) => val.clientId === Number.parseInt(userId)
					);

					const cursor = document.createElement("span");

					if (!presence) {
						return cursor;
					}

					cursor.classList.add(
						"relative",
						"border",
						"ml-[-1px]",
						"mr-[-1px]",
						"pointer-events-none",
						"select-none"
					);
					cursor.style.borderColor = presence.color;

					const root = createRoot(cursor);
					root.render(
						<Cursor color={presence.color} name={presence.name} />
					);

					return cursor;
				},
			}),
			CustomLink.configure({
				toggleModal,
			}),
			createHoverExtension(setHoveredLink),
			Commands.configure({
				suggestion: {
					items: getSuggestionItems,
					render: createRenderItems(setShowingAutocomplete),
				},
				showMenu: (bool) => {
					setShowingAutocomplete(bool);
				},
			}),
		],
	});

	if (!editor || !isEditorReady) {
		return <StaticNote />;
	}

	const isEditable =
		props.metadata.allowAnyoneToEdit || props.metadata.isCreatedByYou;

	if (editor.isEditable !== isEditable) {
		editor.setEditable(isEditable);
	}

	// TODO: show EditorLinkTooltip on selection
	return (
		<>
			{commandAutocompleteMenuProps && (
				<AutocompleteCommandsList {...commandAutocompleteMenuProps} />
			)}
			{/* {showingAutocomplete?.render()} */}
			{hoveredLinkDom && (
				<EditorLinkTooltip
					editor={editor}
					hoveredLinkDom={hoveredLinkDom}
					openModal={openModal}
					onMouseLeave={() => setHoveredLink(null)}
				/>
			)}
			<div className="flex h-full w-full flex-col">
				<EditorBubbleMenu editor={editor} />
				<EditorContent
					className="rounded-box bg-base-100 h-full w-full min-w-0"
					editor={editor}
				/>
			</div>
		</>
	);
}