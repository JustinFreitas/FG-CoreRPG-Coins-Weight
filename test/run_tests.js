const { LuaFactory } = require('wasmoon');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function run() {
    console.log("Initializing Lua Environment...");
    const factory = new LuaFactory();
    const lua = await factory.createEngine();

    try {
        // Load mock Fantasy Grounds environment
        const mockFg = fs.readFileSync(path.join(__dirname, 'mock_fg.lua'), 'utf-8');
        await lua.doString(mockFg);

        // Load the coinweight script
        const coinweight = fs.readFileSync(path.join(__dirname, '../scripts/coinweight.lua'), 'utf-8');
        await lua.doString(coinweight);

        console.log("Mocks and script loaded successfully. Starting tests...\n");

        // Helper to reset DB and call onInit
        async function resetAndInit(isHost = true) {
            await lua.doString(`
                DB.reset()
                Session.IsHost = ${isHost}
                onInit()
            `);
        }

        // Test 1: onInit behavior
        console.log("Running Test 1: onInit behavior...");
        await resetAndInit(true);
        const handlersCount = await lua.doString(`return #DB.handlers`);
        assert.strictEqual(handlersCount, 4, "Should register 4 DB handlers when host");

        const calcEncumbranceRes = await lua.doString(`return CharEncumbranceManager.calcDefaultCurrencyEncumbrance()`);
        assert.strictEqual(calcEncumbranceRes, 0, "Should replace calcDefaultCurrencyEncumbrance to return 0");

        await resetAndInit(false);
        const handlersCountClient = await lua.doString(`return #DB.handlers`);
        assert.strictEqual(handlersCountClient, 0, "Should not register DB handlers when client");
        console.log("Test 1 Passed!\n");

        // Test 2: Standard coin calculation (wealth and weight)
        console.log("Running Test 2: Standard coin calculation...");
        await resetAndInit(true);
        await lua.doString(`
            simulateUpdateCoin("id-00001", "slot-1", "gp", 100)
            simulateUpdateCoin("id-00001", "slot-2", "pp", 50)
        `);

        const shortcutType = await lua.doString(`
            local shortcutNode = DB.findNode("charsheet.id-00001.coinitemshortcut")
            if not shortcutNode then return nil end
            return shortcutNode.type
        `);
        assert.strictEqual(shortcutType, "windowreference", "Shortcut should be windowreference");

        const shortcutValue = await lua.doString(`
            local val1, val2 = DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut")
            return {val1, val2}
        `);
        assert.strictEqual(shortcutValue[0], "item", "Shortcut class should be 'item'");
        assert.ok(shortcutValue[1].startsWith("charsheet.id-00001.inventorylist.id-"), "Shortcut path should point to inventorylist item");

        const coinsItemPath = shortcutValue[1];
        const coinsName = await lua.doString(`return DB.getValue(DB.findNode("${coinsItemPath}"), "name")`);
        assert.strictEqual(coinsName, "Coins", "Item name should be 'Coins'");

        const coinsCount = await lua.doString(`return DB.getValue(DB.findNode("${coinsItemPath}"), "count")`);
        assert.strictEqual(coinsCount, 1, "Item count should be 1");

        const coinsType = await lua.doString(`return DB.getValue(DB.findNode("${coinsItemPath}"), "type")`);
        assert.strictEqual(coinsType, "Wealth and Money", "Item type should be 'Wealth and Money'");

        const coinsCost = await lua.doString(`return DB.getValue(DB.findNode("${coinsItemPath}"), "cost")`);
        assert.strictEqual(coinsCost, "600 gp", "Total wealth cost string should be '600 gp'");

        const coinsWeight = await lua.doString(`return DB.getValue(DB.findNode("${coinsItemPath}"), "weight")`);
        assert.strictEqual(coinsWeight, 3.0, "Total weight should be 3");
        console.log("Test 2 Passed!\n");

        // Test 3: Rounding thresholds
        console.log("Running Test 3: Rounding thresholds...");

        // Subcase 3a: >= 100 weight (rounds to 0 decimal places)
        await resetAndInit(true);
        await lua.doString(`simulateUpdateCoin("id-00001", "slot-1", "gp", 5025)`);
        let p3a = await lua.doString(`return select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))`);
        let w3a = await lua.doString(`return DB.getValue(DB.findNode("${p3a}"), "weight")`);
        assert.strictEqual(w3a, 101, "Weight >= 100 should round to 0 decimals");

        // Subcase 3b: >= 10 weight (rounds to 1 decimal place)
        await resetAndInit(true);
        await lua.doString(`simulateUpdateCoin("id-00001", "slot-1", "gp", 523)`);
        let p3b = await lua.doString(`return select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))`);
        let w3b = await lua.doString(`return DB.getValue(DB.findNode("${p3b}"), "weight")`);
        assert.strictEqual(w3b, 10.5, "Weight >= 10 should round to 1 decimal");

        // Subcase 3c: >= 1 weight (rounds to 2 decimal places)
        await resetAndInit(true);
        await lua.doString(`
            CurrencyManager.currencies.cp.nWeight = 0.015
            simulateUpdateCoin("id-00001", "slot-1", "cp", 71)
        `);
        let p3c = await lua.doString(`return select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))`);
        let w3c = await lua.doString(`return DB.getValue(DB.findNode("${p3c}"), "weight")`);
        assert.strictEqual(w3c, 1.07, "Weight >= 1 should round to 2 decimals");

        // Subcase 3d: < 1 weight (rounds to 3 decimal places)
        await resetAndInit(true);
        await lua.doString(`
            CurrencyManager.currencies.cp.nWeight = 0.0154
            simulateUpdateCoin("id-00001", "slot-1", "cp", 29)
        `);
        let p3d = await lua.doString(`return select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))`);
        let w3d = await lua.doString(`return DB.getValue(DB.findNode("${p3d}"), "weight")`);
        assert.strictEqual(w3d, 0.447, "Weight < 1 should round to 3 decimals");
        console.log("Test 3 Passed!\n");

        // Test 4: 0 weight and wealth logic
        console.log("Running Test 4: Zero weight and wealth logic...");
        await resetAndInit(true);
        await lua.doString(`simulateUpdateCoin("id-00001", "slot-1", "gp", 0)`);
        let shortcut4 = await lua.doString(`return DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut")`);
        assert.strictEqual(shortcut4, null, "No shortcut should be created for 0 coins");

        // Add then change to 0
        await lua.doString(`simulateUpdateCoin("id-00001", "slot-1", "gp", 10)`);
        let p4 = await lua.doString(`return select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))`);
        assert.ok(p4, "Coins item should exist");

        await lua.doString(`simulateUpdateCoin("id-00001", "slot-1", "gp", 0)`);
        let coinsItemNodeDeleted = await lua.doString(`return DB.findNode("${p4}")`);
        assert.strictEqual(coinsItemNodeDeleted, null, "Coins item node should be deleted when weight/wealth are 0");

        let shortcutDeleted = await lua.doString(`return DB.findNode("charsheet.id-00001.coinitemshortcut")`);
        assert.strictEqual(shortcutDeleted, null, "Shortcut node should be deleted when weight/wealth are 0");
        console.log("Test 4 Passed!\n");

        // Test 5: Coin slot deletion
        console.log("Running Test 5: Coin slot deletion...");
        await resetAndInit(true);
        await lua.doString(`simulateUpdateCoin("id-00001", "slot-1", "gp", 10)`);
        let p5 = await lua.doString(`return select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))`);
        assert.ok(p5, "Coins item should exist before deletion");

        // Delete slot and trigger deleted handler
        await lua.doString(`simulateDeleteCoin("id-00001", "slot-1")`);
        let coinsItemNodeDeleted2 = await lua.doString(`return DB.findNode("${p5}")`);
        assert.strictEqual(coinsItemNodeDeleted2, null, "Coins item node should be deleted after coin slot deletion");
        console.log("Test 5 Passed!\n");

        // Test 6: Custom denomination defaults
        console.log("Running Test 6: Custom denomination defaults...");
        await resetAndInit(true);
        await lua.doString(`simulateUpdateCoin("id-00001", "slot-1", "customcoin", 10)`);
        let p6 = await lua.doString(`return select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))`);

        const customCost = await lua.doString(`return DB.getValue(DB.findNode("${p6}"), "cost")`);
        assert.strictEqual(customCost, "0 gp", "Custom coin value should default to 0");

        const customWeight = await lua.doString(`return DB.getValue(DB.findNode("${p6}"), "weight")`);
        assert.strictEqual(customWeight, 0.2, "Custom coin weight should default to 0.02 per coin");
        console.log("Test 6 Passed!\n");

        // Test 7: Backwards compatibility
        console.log("Running Test 7: Backwards compatibility...");
        await resetAndInit(true);
        await lua.doString(`
            local charNode = DB.createChild(DB.findNode("charsheet"), "id-00001")
            local invNode = DB.createChild(charNode, "inventorylist")
            local itemNode = DB.createChild(invNode, "item-99")
            DB.setValue(itemNode, "name", "string", "Coins")
            
            DB.setValue(charNode, "coinsitembookmark", "string", "charsheet.id-00001.inventorylist.item-99")
            simulateUpdateCoin("id-00001", "slot-1", "gp", 10)
        `);

        const bookmarkNode = await lua.doString(`return DB.findNode("charsheet.id-00001.coinsitembookmark")`);
        assert.strictEqual(bookmarkNode, null, "Bookmark node should be deleted");

        const newShortcutVal = await lua.doString(`
            local _, val = DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut")
            return val
        `);
        assert.strictEqual(newShortcutVal, "charsheet.id-00001.inventorylist.item-99", "Shortcut should point to bookmark's item");
        console.log("Test 7 Passed!\n");

        // Test 8: Denomination updates
        console.log("Running Test 8: Denomination updates...");
        await resetAndInit(true);
        await lua.doString(`
            simulateUpdateCoin("id-00001", "slot-1", "gp", 10)
            simulateUpdateCoin("id-00002", "slot-1", "gp", 20)
        `);

        let w8_1 = await lua.doString(`
            local p = select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))
            return DB.getValue(DB.findNode(p), "weight")
        `);
        let w8_2 = await lua.doString(`
            local p = select(2, DB.getValue(DB.findNode("charsheet.id-00002"), "coinitemshortcut"))
            return DB.getValue(DB.findNode(p), "weight")
        `);
        assert.strictEqual(w8_1, 0.2);
        assert.strictEqual(w8_2, 0.4);

        // Update GP weight and trigger
        await lua.doString(`
            CurrencyManager.currencies.gp.nWeight = 0.05
            local gpNode = DB.createChild(DB.findNode("currencies"), "gp")
            DB.trigger("onChildUpdate", "currencies.gp", gpNode)
        `);

        let newW8_1 = await lua.doString(`
            local p = select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))
            return DB.getValue(DB.findNode(p), "weight")
        `);
        let newW8_2 = await lua.doString(`
            local p = select(2, DB.getValue(DB.findNode("charsheet.id-00002"), "coinitemshortcut"))
            return DB.getValue(DB.findNode(p), "weight")
        `);
        assert.strictEqual(newW8_1, 0.5, "Char 1 should update on denomination change");
        assert.strictEqual(newW8_2, 1.0, "Char 2 should update on denomination change");
        console.log("Test 8 Passed!\n");

        // Test 9: Negative coin weight sets weight to 0
        console.log("Running Test 9: Negative weight fallback...");
        await resetAndInit(true);
        await lua.doString(`
            CurrencyManager.currencies.gp.nWeight = -0.05
            simulateUpdateCoin("id-00001", "slot-1", "gp", 10)
        `);
        let p9 = await lua.doString(`return select(2, DB.getValue(DB.findNode("charsheet.id-00001"), "coinitemshortcut"))`);
        const negativeWeight = await lua.doString(`return DB.getValue(DB.findNode("${p9}"), "weight")`);
        assert.strictEqual(negativeWeight, 0, "Negative weight should be capped at 0");
        console.log("Test 9 Passed!\n");

        console.log("All unit tests passed successfully!");

    } catch (e) {
        console.error("Test failed: ", e);
        process.exit(1);
    } finally {
        lua.global.close();
    }
}

run();
