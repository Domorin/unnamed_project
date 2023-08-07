import { RouterOutput } from "@/server/routers/_app";
import {
	faBold,
	faCode,
	faFileCode,
	faItalic,
	faLink,
	faList,
	faList12,
	faQuoteLeft,
	faStrikethrough,
	faTasks,
	faUnderline,
} from "@fortawesome/free-solid-svg-icons";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Link from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { NodeType, Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
	BubbleMenu,
	Editor,
	EditorContent,
	getNodeType,
	useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "tiptap-markdown";
import { UserPresence } from "../../../../common/ws/types";
import { CustomProvider } from "../../../../common/yjs/custom_provider";
import { ModalLinkInput } from "../modals/modal_link_input";
import { EditorButton } from "./buttons/editor_button";
import { Cursor } from "./cursor";
import { CustomLink } from "./custom_link";

const CreateLinkExtension = (setModalActive: () => void) =>
	Link.extend({
		addAttributes() {
			return {
				...this.parent?.(),
				title: {
					// Take the attribute values
					renderHTML: (attributes) => {
						// … and return an object with HTML attributes.
						return {
							title: `${attributes.href}`,
						};
					},
				},
			};
		},
		// renderHTML(stuff) {
		// 	console.log(JSON.stringify(stuff));
		// 	return ["strong", stuff.HTMLAttributes, ["a", "hi"]];
		// },
		addKeyboardShortcuts() {
			return {
				"Mod-k": () => {
					setModalActive();
					return true;
				},
			};
		},
	});

function setLink(
	editor: Pick<Editor, "getAttributes" | "chain"> | undefined,
	url: string,
	label: string
) {
	if (!editor) return false;

	// const previousUrl = editor.getAttributes("link").href;
	// const url = window.prompt("URL", previousUrl);

	// cancelled
	if (url === null) {
		return false;
	}

	// empty
	if (url === "") {
		editor.chain().focus().extendMarkRange("link").unsetLink().run();

		return false;
	}

	// https://github.com/ueberdosis/tiptap/issues/2571
	// update link
	// https://github.com/ueberdosis/tiptap/issues/373
	console.log("running");
	editor
		.chain()
		.focus()
		.extendMarkRange("link")
		// .setLink({ href: url })
		// .command(({ tr }) => {
		// 	tr.insertText(label);
		// 	return true;
		// })
		.run();
}

export function WysiwygEditor(props: {
	slug: string;
	provider: CustomProvider;
	presences: UserPresence[];
	metadata: RouterOutput["note"]["metadata"];
}) {
	const ref = useRef(props.presences);
	const [modalActive, setModalActive] = useState(false);

	if (props.presences !== ref.current) {
		ref.current = props.presences;
	}

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				history: false,
			}),
			Markdown.configure({
				breaks: true,
				html: true,
				linkify: true,
				transformCopiedText: true,
				transformPastedText: true,
			}),
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
			TaskList,
			TaskItem,
			Underline,
			CustomLink.configure({
				toggleModal: () => setModalActive(!modalActive),
			}),
		],
	});

	if (!editor) {
		return <></>;
	}

	editor.setEditable(
		props.metadata.allowAnyoneToEdit || props.metadata.isCreatedByYou
	);

	const linkAttributes = editor.getAttributes("customLink");

	return (
		<>
			<ModalLinkInput
				isActive={modalActive}
				close={() => setModalActive(false)}
				initialUrl={linkAttributes?.href}
				initialLabel={linkAttributes?.title}
				onSubmit={(url, label) => {
					editor.commands.createCustomLink({
						title: label,
						href: url,
					});
				}}
			/>
			<div className="flex h-full w-full flex-col">
				<BubbleMenu editor={editor}>
					<div className="join overflow-hidden border border-neutral bg-base-300">
						<EditorButton
							hotkey="ctrl b"
							editor={editor}
							icon={faBold}
							onClick={(editor) =>
								editor.chain().focus().toggleBold().run()
							}
							label="bold"
						/>
						<EditorButton
							hotkey="ctrl shift X"
							label="italic"
							editor={editor}
							icon={faItalic}
							onClick={(editor) =>
								editor.chain().focus().toggleItalic().run()
							}
						/>
						<EditorButton
							hotkey="ctrl u"
							label="underline"
							editor={editor}
							icon={faUnderline}
							onClick={() =>
								editor?.chain().focus().toggleUnderline().run()
							}
						/>
						<EditorButton
							hotkey="ctrl shift b"
							label="blockquote"
							editor={editor}
							icon={faQuoteLeft}
							onClick={() =>
								editor?.chain().focus().toggleBlockquote().run()
							}
						/>
						<EditorButton
							hotkey="ctrl shift 8"
							label="bulletlist"
							editor={editor}
							icon={faList}
							onClick={() =>
								editor?.chain().focus().toggleBulletList().run()
							}
						/>
						<EditorButton
							hotkey="ctrl shift 8"
							label="orderedlist"
							editor={editor}
							icon={faList12}
							onClick={() =>
								editor
									?.chain()
									.focus()
									.toggleOrderedList()
									.run()
							}
						/>
						<EditorButton
							hotkey="ctrl shift 9"
							label="tasklist"
							editor={editor}
							icon={faTasks}
							onClick={() =>
								editor?.chain().focus().toggleTaskList().run()
							}
						/>
						<EditorButton
							hotkey="ctrl e"
							label="code"
							editor={editor}
							icon={faCode}
							onClick={() =>
								editor?.chain().focus().toggleCode().run()
							}
						/>
						<EditorButton
							hotkey="ctrl alt c"
							label="codeblock"
							editor={editor}
							icon={faFileCode}
							onClick={() =>
								editor?.chain().focus().toggleCodeBlock().run()
							}
						/>
						<EditorButton
							hotkey="ctrl shift x"
							label="strike"
							editor={editor}
							icon={faStrikethrough}
							onClick={() =>
								editor?.chain().focus().toggleStrike().run()
							}
						/>
						<EditorButton
							hotkey="ctrl k"
							label="link"
							editor={editor}
							icon={faLink}
							onClick={(e) => {
								setModalActive(true);
							}}
						/>
					</div>
				</BubbleMenu>
				<EditorContent
					className="rounded-box h-full w-full min-w-0 bg-base-100"
					editor={editor}
				/>
			</div>
		</>
	);
}
