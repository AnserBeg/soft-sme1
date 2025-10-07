# Team Messaging Overview

The NeuraTask frontend now includes a dedicated **Messaging** workspace that surfaces both direct messages and group chats. The messaging panel keeps state in a shared React context, performs optimistic updates when you send messages, and polls the server every 10 seconds to stay in sync with new activity.

## Starting a conversation
1. Open the **Messaging** page from the sidebar.
2. Use the **New** button to pick one teammate for a direct chat or multiple teammates for a group conversation.
3. Provide a group name when more than one participant is selected, then click **Start**.
4. Existing one-on-one conversations are reused automatically; you will jump straight into the history if a thread already exists.

## Working in a thread
- Messages you send appear instantly while the backend request completes. Any failures are highlighted so you can retry.
- History refreshes automatically every 10 seconds for the active conversation, in addition to manual fetches when you switch threads.
- Participant details and last-message timestamps are shown in the conversation list to help you triage discussions quickly.

---

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).
