import { createSignal } from "solid-js";
import { invoke } from "../utils/PlatformProxy.ts";

interface GreetResponse {
	name: string;
}

export function Greet() {
	const [greetMsg, setGreetMsg] = createSignal("");
	const [name, setName] = createSignal("");

	async function greet() {
		const response = await invoke<GreetResponse>("greet", { args: { name: name() }, apiOptions: "application/json" });

		console.log(response)
		if (response) {
			setGreetMsg(response);
		} else {
			setGreetMsg("An error occurred or the response format was unexpected.");
		}
	}

	return <>
		<form
			class="row"
			onSubmit={(e) => {
				e.preventDefault();
				greet();
			}}
		>
			<input
				id="greet-input"
				onChange={(e) => setName(e.currentTarget.value)}
				placeholder="Enter a name..."
			/>
			<button type="submit">Greet</button>
		</form>

		<p class="row">{greetMsg()}</p>
	</>
}
