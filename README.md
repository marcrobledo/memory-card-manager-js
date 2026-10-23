# Memory Card Manager
A console memory card manager made in HTML5.

**Features:**
- **Supported systems:**
   - PlayStation
   - GameCube
   - Dreamcast
   - Sega Saturn
   - Mega CD / Sega CD
   - Nintendo 64 Controller Pak
- Read and write from/to memory card raw dumps
- Import and export single savegames
- Copy savegames between memory cards

It is an interface capable of managing any console memory card raw dumps and their contents: export and import savegames, format memory card, preview game icons, transfer between memory cards, etc.

I started this in 2019 as a proof of concept, managed to resume it in 2023 and implemented fully functional [PlayStation support](https://www.marcrobledo.com/memory-card-manager-js/psx/). A few years later, I ended up implementing GameCube and Dreamcast in order to prove the potential of the interface.

Support for Sega Saturn, Nintendo 64 Controller Pak and Mega CD were done by an AI agent with few human edits. The project's structure was good enough for it to give decent results and clean code.

## Resources used
* [Octicons](https://primer.style/octicons/) by GitHub Inc.
* systems' file structures were already documented, so I based code mostly on them (see their respective `.js` files for sources used)

## License
This project is licensed under the [MIT License](https://github.com/marcrobledo/memory-card-manager-js?tab=License-1-ov-file).
Except `ss/.js`, `mcd/.js` and `n64/.js` which are all released under no license.