import { useNoteListRecent } from "@/pages/react/hooks/use_recent_local_storage";
import { RouterOutput } from "@/server/routers/_app";
import { faClone, faX } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export function RemoveFromRecentsOption(props: {
	metadata: RouterOutput["note"]["metadata"];
	disabled: boolean;
}) {
	const { remove } = useNoteListRecent();

	return (
		<div
			className="flex items-center gap-2"
			onClick={() => {
				remove(props.metadata.slug);
			}}
		>
			<div className="flex w-6 justify-center">
				<FontAwesomeIcon icon={faX} />
			</div>
			<div>Remove from Recents</div>
		</div>
	);
}
