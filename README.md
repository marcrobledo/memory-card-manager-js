# Memory Card Manager
A console memory card manager made in HTML5.

**Features:**
- Read and write from/to memory card raw dumps
- Import and export single savegames
- Copy savegames between memory cards
- **Supported systems:** **PlayStation**, Gamecube<sup>1</sup>

It is an interface capable of managing any console memory card raw dumps and their contents: export and import savegames, format memory card, preview game icons, transfer between memory cards, etc.

I started this in 2019 as a proof of concept, managed to resume it in 2023 and implemented fully functional [PlayStation support](https://www.marcrobledo.com/memory-card-manager-js/psx/).

<sup>1</sup> Unfortunately, due to lack of time, I never managed to finish [GameCube support](https://www.marcrobledo.com/memory-card-manager-js/gc/), it loads data correctly, but it's missing correct code for checksum recalculation (in other words: the saved data won't be read by the console). Still, I leave it here as a proof of the interface potential.

## To-do
- rewrite using more modern Javascript code
- fix Gamecube support
- add support for other systems: Dreamcast, N64 Controller Pak...

## Resources used
* [Octicons](https://primer.style/octicons/) by GitHub Inc.

## License
This project is licensed under the [MIT License](https://github.com/marcrobledo/memory-card-manager-js?tab=License-1-ov-file).