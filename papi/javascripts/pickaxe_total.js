function getPickaxeTotal() {
    var blocks = [
        "stone",
        "cobblestone",
        "deepslate",
        "cobbled_deepslate",
        "coal_ore",
        "deepslate_coal_ore",
        "iron_ore",
        "deepslate_iron_ore",
        "gold_ore",
        "deepslate_gold_ore",
        "diamond_ore",
        "deepslate_diamond_ore",
        "netherrack",
        "ancient_debris",
        "obsidian"
    ];

    var total = 0;
    for (var i = 0; i < blocks.length; i++) {
        var raw = PlaceholderAPI.static.setPlaceholders(BukkitPlayer, "%statistic_mine_block:" + blocks[i] + "%");
        var val = parseInt(raw);
        if (!isNaN(val)) {
            total += val;
        }
    }
    return total;
}

getPickaxeTotal();
