import { httpBatchLink } from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import type { AppRouter } from "../server/routers/_app";

function getBaseUrl() {
	if (typeof window !== "undefined")
		// browser should use relative path
		return "";

	if (process.env.VERCEL_URL)
		// reference for vercel.com
		return `https://${process.env.VERCEL_URL}`;

	if (process.env.RENDER_INTERNAL_HOSTNAME)
		// reference for render.com
		return `http://${process.env.RENDER_INTERNAL_HOSTNAME}:${process.env.PORT}`;

	// assume localhost
	return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const trpc = createTRPCNext<AppRouter>({
	config(opts) {
		console.log("hello?");

		const isSsr = typeof window === "undefined";

		return {
			links: [
				httpBatchLink({
					/**
					 * If you want to use SSR, you need to use the server's full URL
					 * @link https://trpc.io/docs/ssr
					 **/
					url: `${getBaseUrl()}/api/trpc`,

					// You can pass any HTTP headers you wish here
					async headers() {
						if (opts.ctx?.req) {
							return {
								test: "hello",
							};
						}
						return {};
					},
				}),
			],
		};
	},
	/**
	 * @link https://trpc.io/docs/ssr
	 **/
	ssr: false,
});
