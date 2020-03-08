target remote :3333

# monitor itm port 0 on
# monitor tpiu config internal /tmp/itm.fifo uart off 2000000

set print asm-demangle on
monitor arm semihosting enable

load

# break DefaultHandler
# break HardFault
# break rust_begin_unwind

continue