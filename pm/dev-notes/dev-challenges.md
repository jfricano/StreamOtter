1. wanted to make sure that indeed creating a useful tool. analyzed the API after writing it, and wrote up a statement that summarizes the vision and efficiency gains for developers.

2. testing the websocket. once set up, occurred to me that the node environment doesn't have native support for websockets. I realized that I could conditionally import WebSocket or use dependency injection to provide the WebSocket implementation. This allows you to use the native WebSocket in browser environments and a polyfill or alternative implementation (like ws) in Node.js.

   This not only addressed the problem i was aiming to solve, but also unlcoked an additional feature, as the library will now support non-browswer situations where websockets might not be readily available.

3.
