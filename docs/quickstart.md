# Quickstart

Inspect your first Figma design in a few minutes: sign in, scout a link, and read the result. This page assumes figma-lens and a token are set up, as covered in [Install](install.md) and [Authentication](authentication.md).

## 1. Check that it works

```sh
figma-lens doctor
```

You should see `"ok": true` and your Figma account handle.

## 2. Scout a board or flow

Copy a link to a Figma board, flow or screen from Figma, then run:

```sh
figma-lens scout "https://www.figma.com/design/FILE_KEY/File?node-id=1-2"
```

The output is a short JSON summary. Open the file named in `overview.screenshot` to see the design. `overview.states` lists the screens or states in order, each with its node ID, and `next` holds commands you can copy for the following step.

## 3. Pull out one screen

When the link points at one exact screen, or `scout` showed you which screen you want, ask for it by description:

```sh
figma-lens extract "https://www.figma.com/design/FILE_KEY/File?node-id=1-2" \
  --intent "the screen I want to build"
```

`extract` saves a screenshot of that screen, the text that appears on it, a summary of its layout and typography, and any icons or illustrations it found. The JSON on screen lists the paths.

If the description is too vague to pick one screen, `extract` stops and prints a `scout` command to run instead of guessing.

## 4. Look at the results

Results are saved in `.figma-lens/` in the current folder. Add that folder to `.gitignore`, because it can hold private designs and images.

## Next steps

- Describe a design without a link: [Find designs without a link](find-designs.md).
- Build a screen and check it against the design: [Design-to-code workflow](design-to-code.md).
- Hand the work to an agent: [Use with coding agents](agents.md).
