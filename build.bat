emcc main.cpp -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME=Module -o main.js -std=c++17 --bind
