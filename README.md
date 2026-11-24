# Interview Buddy

Turns a job posting into practice problems and checks your answers on your own computer. It covers coding, quant, math, physics, chemistry, circuit design and any other subject you name.

It uses the Claude and ChatGPT sign-ins you already have through the `claude` and `codex` commands. There is no API key and no hosted service.

## Install

You need macOS, Node 22 or newer, Python 3, and at least one of:

- ChatGPT through [Codex](https://developers.openai.com/codex/cli): `codex login`
- Claude through [Claude Code](https://code.claude.com): `claude auth login`

C++ also needs Apple's compiler, from `xcode-select --install`.

```sh
npm install -g github:chewton2k/interview-buddy
interview-buddy
```

The command starts a server on `http://localhost:4747` and opens it in your browser. Use `--port` for another port and `--no-open` to skip the browser.

## How it works

1. Paste the posting, then add the company, the role, what the interview has and the subjects.
2. A model plans the set. Each problem quotes the words in your posting that it trains.
3. Each problem is written and then checked on your computer before you see it.
4. You answer, run the tests and ask for feedback.

Choose the account, model and effort in Settings, separately for writing problems and for grading answers.

## What is checked

| Kind | Check before you see it | How your answer is judged |
| --- | --- | --- |
| Code (Python, JavaScript, C++) | Two different solutions run on every input and must agree with each other and with the examples. Expected outputs come from those runs. | Your code runs against every test |
| Number | A separate solver must reach the stated answer | Your number is compared within a tolerance, in the stated unit |
| Written | Nothing is executed | A model grades it against a rubric |

A draft that fails is sent back with the reason, up to three tries. One model writes both solutions, so a mistake they share can still get through. Figures and rubrics are not checked.

## Safety

- Your code and generated code run under macOS `sandbox-exec` with no network, no access to your home folder, no writes outside a temporary folder, no new processes while running, a 10 second limit and a 1 GB memory limit. If the sandbox does not start, nothing runs.
- Apple marks `sandbox-exec` as deprecated and the profile blocks listed things rather than allowing listed things. It is meant to contain mistakes, not a determined attacker.
- The server listens on `127.0.0.1` only and refuses requests from other sites. Other programs on your computer can still reach it.
- Postings and answers go to the model account you choose, and nowhere else. Sets and settings are stored in `~/.interview-buddy`.

## Limits

- Code and number problems need macOS. Elsewhere only written problems work.
- Functions use numbers, strings, booleans and nested lists. Trees, graphs and class designs are expressed with those.
- There is no circuit or Verilog simulator.

## Development

```sh
npm install
npm start
npm test
npm run coverage
INTERVIEW_BUDDY_LIVE=1 npm test   # also calls the real accounts
```
