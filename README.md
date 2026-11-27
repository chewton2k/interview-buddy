# Interview Buddy

Turns a job posting into practice problems and checks your answers on your own computer. It covers coding, AI-native coding in a multi-file codebase, system design, frontend, SQL, machine learning, circuits, quant, math, statistics, physics, chemistry, biology, UI/UX design, product sense, case studies, finance, behavioral interviews and any other subject you name.

It uses the Claude and ChatGPT sign-ins you already have through the `claude` and `codex` commands. There is no API key and no hosted service.

## Install

You need macOS, Node 22 or newer, Python 3, and at least one of:

- Codex, with a ChatGPT account, from [Codex](https://developers.openai.com/codex/cli): `codex login`
- Claude through [Claude Code](https://code.claude.com): `claude auth login`

C++ also needs Apple's compiler, from `xcode-select --install`.

```sh
git clone https://github.com/chewton2k/interview-buddy
cd interview-buddy
npm install
npm link
interview-buddy
```

The command starts a server on `http://localhost:4747` and opens it in your browser. Use `--port` for another port and `--no-open` to skip the browser.

## How it works

1. Paste the posting, then add the company, the role, what the interview has and the subjects.
2. A model plans the set. Each problem quotes the words in your posting that it trains.
3. Each problem is written and then checked on your computer before you see it.
4. You answer, run the tests and ask for feedback.

Choose Claude or Codex and a model in Settings. It is used for everything. Settings also has light and dark mode.

- **A coding pad, not a quiz page.** Run executes your file and prints to a console. You write your own tests, talk to an interviewer who sees your code, and can start a clock. Hidden tests, hints, feedback and the solution open when you finish the interview.
- **AI-native coding rounds.** Pick the AI-native coding subject for a small Python codebase with a file tree, data files, tests, a terminal, Run main and Run tests, an interviewer, and an AI assistant that sees every file. The assistant has two modes, like CoderPad: Ask answers and suggests, and Edit proposes changes that you see as a diff per file and accept or reject. The task comes in three parts that open one at a time with Next part, as an interviewer would hand them out: fix, extend, then a harder follow-up. Select code to ask the assistant or the interviewer about those lines. After you finish, Review shows a diff of every file you changed. Finishing runs your code against the original tests plus hidden ones, and feedback covers how you used the assistant.
- **Write and draw.** Answers take text, equations you type and see typeset, and drawings on a whiteboard. Grading, chat and analysis see all three.
- **Analyze** draws your own solution as an interactive picture. Python runs are recorded line by line, so the picture shows what your code really did. For other work the model draws it from your answer.
- **Ask** opens a chat beside other problems. It sees your current work.
- **Make a problem** turns a link or an idea into a problem, such as "https://... make this into a quant problem". It is on the home page, in every set, and in the chat.
- **Add more problems** writes 1 to 10 new ones for a set you already have, from the same posting, without repeating what is there.

## What is checked

| Kind | Check before you see it | How your answer is judged |
| --- | --- | --- |
| Code (Python, JavaScript, C++) | Two different solutions run on every input and must agree with each other and with the examples. Expected outputs come from those runs. | Your code runs against every hidden test when you finish |
| Codebase (Python) | The hidden and given tests must fail on the starting files and all pass with the reference changes, and main.py must run | Your files run against the original tests and the hidden tests when you finish. Tests you add are shown but not required |
| SQL (SQLite) | Two different queries must return the same rows on every dataset | Your query runs on every dataset |
| Interface (HTML, CSS, JavaScript) | Checks must parse. In your browser, checks that fail on the reference solution or pass on the starting page are dropped. | The remaining checks run on your page, each on a fresh load |
| Number | A separate solver must reach the stated answer | Your number is compared within a tolerance, in the stated unit |
| Written | Nothing is executed | A model grades it against a rubric |

A draft that fails is sent back with the reason, up to three tries. One model writes both solutions, so a mistake they share can still get through. Figures and rubrics are not checked.

## Safety

- Your code and generated code run under macOS `sandbox-exec` with no network, no access to your home folder, no writes outside a temporary folder, no new processes while running, a 10 second limit and a 1 GB memory limit. If the sandbox does not start, nothing runs.
- Apple marks `sandbox-exec` as deprecated and the profile blocks listed things rather than allowing listed things. It is meant to contain mistakes, not a determined attacker.
- The server listens on `127.0.0.1` only and refuses requests from other sites. Other programs on your computer can still reach it.
- Analysis pages and interface previews run in locked frames with no network, no storage and no access to the app.
- Links are opened only when you paste them. Addresses inside your computer or local network are refused, including through redirects.
- Code under test can read the environment variables Interview Buddy was started with. It has no network to send them anywhere, but they could appear in its output.
- Postings, answers, chats and the text of links you paste go to the model account you choose, and nowhere else. Sets and settings are stored in `~/.interview-buddy`.

## Limits

- Code, SQL and number problems need macOS. Elsewhere only written and interface problems work.
- Functions use numbers, strings, booleans and nested lists. Trees, graphs and class designs are expressed with those.
- There is no circuit or Verilog simulator.
- Codebase problems are Python only, run with `unittest` from the standard library. There is no shell and no package installs. Assistant edits replace whole files, and it cannot delete files.
- Links must be readable pages. PDFs and pages that need a browser or a sign-in have to be pasted as text.

## Built with

[CodeMirror](https://codemirror.net), [MathLive](https://mathlive.io), [Excalidraw](https://excalidraw.com), [KaTeX](https://katex.org), [Preact](https://preactjs.com) and the [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) typeface. All are open source and bundled, so nothing is loaded from other sites.

## Development

```sh
npm install
npm start
npm test
npm run coverage
INTERVIEW_BUDDY_LIVE=1 npm test   # also calls the real accounts
```
