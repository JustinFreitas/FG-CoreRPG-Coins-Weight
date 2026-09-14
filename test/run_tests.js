const { LuaFactory } = require('wasmoon');
const fs = require('fs');
const path = require('path');

async function runTests() {
    const factory = new LuaFactory();
    const lua = await factory.createEngine();

    console.log("Setting up mock environment for FG-CoreRPG-Coins-Weight...");

    await lua.doString(`
        Session = { IsHost = true }
        User = {
            isHost = function() return true end,
            getRulesetName = function() return "5E" end
        }

        Interface = {
            getString = function(s)
                if s == "item_description_coins" then
                    return "A standard coin weighs about a third of an ounce (50 to the pound)."
                end
                return s or ""
            end
        }

        Debug = {
            chat = function(...) end
        }

        -- Database Mock
        db_store = {}
        db_handlers = {}

        local function normalizePath(path)
            return path
        end

        local Node = {}
        Node.__index = Node

        function Node.new(sPath, tData)
            local self = setmetatable({}, Node)
            self._path = sPath
            self._data = tData or {}
            self._children = {}
            self._name = sPath:match("([^.]+)$") or ""
            return self
        end

        function Node:getPath() return self._path end
        function Node:getNodeName() return self._path end
        function Node:getName() return self._name end
        function Node:getParent()
            local sParentPath = self._path:match("^(.*)%.[^.]+$")
            if not sParentPath then return nil end
            if not db_store[sParentPath] then
                db_store[sParentPath] = Node.new(sParentPath)
            end
            return db_store[sParentPath]
        end
        function Node:getChild(sSub)
            local sChildPath = self._path .. "." .. sSub
            return db_store[sChildPath]
        end
        function Node:delete()
            db_store[self._path] = nil
        end

        DB = {
            findNode = function(sPath)
                return db_store[sPath]
            end,
            getParent = function(v)
                if type(v) == "table" and v.getParent then
                    return v:getParent()
                elseif type(v) == "string" then
                    local sParent = v:match("^(.*)%.[^.]+$")
                    if sParent then
                        if not db_store[sParent] then
                            db_store[sParent] = Node.new(sParent)
                        end
                        return db_store[sParent]
                    end
                end
                return nil
            end,
            getName = function(v)
                if type(v) == "table" and v.getName then
                    return v:getName()
                elseif type(v) == "string" then
                    return v:match("([^.]+)$") or ""
                end
                return ""
            end,
            getPath = function(v, sSub)
                local basePath = type(v) == "table" and v._path or tostring(v)
                if sSub and sSub ~= "" then
                    return basePath .. "." .. sSub
                end
                return basePath
            end,
            getChild = function(v, sSub)
                if not v then return nil end
                local sPath = type(v) == "table" and v._path or tostring(v)
                if sSub == "..." then
                    -- Go up two levels: e.g. charsheet.id-00001.coins.id-00001 -> charsheet.id-00001
                    local p1 = sPath:match("^(.*)%.[^.]+$")
                    local p2 = p1 and p1:match("^(.*)%.[^.]+$")
                    return p2 and db_store[p2] or nil
                elseif sSub == ".." then
                    local p1 = sPath:match("^(.*)%.[^.]+$")
                    return p1 and db_store[p1] or nil
                else
                    return db_store[sPath .. "." .. sSub]
                end
            end,
            getChildren = function(v, sSub)
                local sParentPath
                if sSub and sSub ~= "" then
                    sParentPath = (type(v) == "table" and v._path or tostring(v)) .. "." .. sSub
                else
                    sParentPath = type(v) == "table" and v._path or tostring(v)
                end
                local res = {}
                for k, node in pairs(db_store) do
                    local sParent = k:match("^(.*)%.[^.]+$")
                    if sParent == sParentPath then
                        local sChildName = k:match("([^.]+)$")
                        res[sChildName] = node
                    end
                end
                return res
            end,
            getValue = function(v, sSub, defaultVal)
                local sFullPath
                if sSub and sSub ~= "" then
                    sFullPath = (type(v) == "table" and v._path or tostring(v)) .. "." .. sSub
                else
                    sFullPath = type(v) == "table" and v._path or tostring(v)
                end
                local node = db_store[sFullPath]
                if node and node._data and node._data.value ~= nil then
                    return node._data.value
                end
                return defaultVal
            end,
            setValue = function(v, sSub, sType, val)
                local sFullPath
                if sType and val ~= nil then
                    sFullPath = (type(v) == "table" and v._path or tostring(v)) .. "." .. sSub
                else
                    sFullPath = (type(v) == "table" and v._path or tostring(v))
                    val = sType
                end
                local current = ""
                for part in sFullPath:gmatch("([^.]+)") do
                    if current == "" then
                        current = part
                    else
                        current = current .. "." .. part
                    end
                    if not db_store[current] then
                        db_store[current] = Node.new(current)
                    end
                end
                local node = db_store[sFullPath]
                node._data.value = val
                node._data.type = sType
            end,
            createChild = function(v, sChildName)
                local sParentPath = type(v) == "table" and v._path or tostring(v)
                local current = ""
                for part in sParentPath:gmatch("([^.]+)") do
                    if current == "" then
                        current = part
                    else
                        current = current .. "." .. part
                    end
                    if not db_store[current] then
                        db_store[current] = Node.new(current)
                    end
                end
                if not sChildName or sChildName == "" then
                    local i = 1
                    while db_store[string.format("%s.id-%05d", sParentPath, i)] do
                        i = i + 1
                    end
                    sChildName = string.format("id-%05d", i)
                end
                local sChildPath = sParentPath .. "." .. sChildName
                local node = db_store[sChildPath]
                if not node then
                    node = Node.new(sChildPath)
                    db_store[sChildPath] = node
                end
                return node
            end,
            deleteNode = function(v)
                local sPath = type(v) == "table" and v._path or tostring(v)
                -- delete node and all subnodes
                for k, _ in pairs(db_store) do
                    if k == sPath or k:sub(1, #sPath + 1) == (sPath .. ".") then
                        db_store[k] = nil
                    end
                end
            end,
            addHandler = function(pattern, event, callback)
                table.insert(db_handlers, { pattern = pattern, event = event, callback = callback })
            end
        }
    `);

    // Load coinweight.lua
    const scriptPath = path.join(__dirname, '..', 'scripts', 'coinweight.lua');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    await lua.doString(scriptContent);
    console.log("coinweight.lua loaded into Lua VM successfully.\n");

    let totalTests = 0;
    let passedTests = 0;

    function assertTest(condition, description) {
        totalTests++;
        if (condition) {
            console.log(`  PASS: ${description}`);
            passedTests++;
        } else {
            console.error(`  FAIL: ${description}`);
            process.exitCode = 1;
        }
    }

    // Test 1: determineRounding function thresholds
    console.log("Test 1: Rounding thresholds for coin weight...");
    const r1 = await lua.doString(`return determineRounding(150)`);
    assertTest(r1 === 0, "Weight >= 100 rounds to 0 decimals, got " + r1);
    const r2 = await lua.doString(`return determineRounding(50)`);
    assertTest(r2 === 1, "Weight >= 10 rounds to 1 decimal, got " + r2);
    const r3 = await lua.doString(`return determineRounding(5.5)`);
    assertTest(r3 === 2, "Weight >= 1 rounds to 2 decimals, got " + r3);
    const r4 = await lua.doString(`return determineRounding(0.45)`);
    assertTest(r4 === 3, "Weight < 1 rounds to 3 decimals, got " + r4);

    // Test 2: round function
    console.log("\nTest 2: Round function accuracy...");
    const rnd1 = await lua.doString(`return round(12.3456, 2)`);
    assertTest(Math.abs(rnd1 - 12.35) < 0.0001, "round(12.3456, 2) = 12.35, got " + rnd1);
    const rnd2 = await lua.doString(`return round(150.8, 0)`);
    assertTest(rnd2 === 151, "round(150.8, 0) = 151, got " + rnd2);

    // Test 3: Denominations table initialization for 5E
    console.log("\nTest 3: Denominations loaded for 5E ruleset...");
    await lua.doString(`onInit()`);
    const gpVal = await lua.doString(`return aDenominations['gp'].nValue`);
    const gpWeight = await lua.doString(`return aDenominations['gp'].nWeight`);
    assertTest(gpVal === 1, "gp value = 1, got " + gpVal);
    assertTest(gpWeight === 0.02, "gp weight = 0.02, got " + gpWeight);
    const ppVal = await lua.doString(`return aDenominations['pp'].nValue`);
    assertTest(ppVal === 10, "pp value = 10, got " + ppVal);

    // Test 4: computeCoins calculates weight and creates "Coins" inventory item
    console.log("\nTest 4: computeCoins calculation and inventory item creation...");
    await lua.doString(`
        -- Create charsheet.id-00001
        DB.setValue("charsheet.id-00001", "name", "string", "Test PC")
        
        -- Add 100 gp and 50 sp
        DB.setValue("charsheet.id-00001.coins.slot1", "name", "string", "GP")
        DB.setValue("charsheet.id-00001.coins.slot1", "amount", "number", 100)
        DB.setValue("charsheet.id-00001.coins.slot2", "name", "string", "SP")
        DB.setValue("charsheet.id-00001.coins.slot2", "amount", "number", 50)
        
        local nodeChar = DB.findNode("charsheet.id-00001")
        computeCoins(nodeChar)
    `);

    const coinsItem = await lua.doString(`
        local nodeChar = DB.findNode("charsheet.id-00001")
        local item = findCoinsItem(nodeChar)
        if not item then return nil end
        return {
            name = DB.getValue(item, "name", ""),
            weight = DB.getValue(item, "weight", 0),
            cost = DB.getValue(item, "cost", "")
        }
    `);

    assertTest(coinsItem !== null, "Coins inventory item was created");
    assertTest(coinsItem.name === "Coins", "Item name is 'Coins', got " + coinsItem.name);
    // 150 coins * 0.02 = 3.0 lbs
    assertTest(Math.abs(coinsItem.weight - 3.0) < 0.01, "Weight is 3.0 lbs, got " + coinsItem.weight);
    // 100 gp + 50*0.1 gp = 105 gp
    assertTest(coinsItem.cost === "105 gp", "Cost is '105 gp', got " + coinsItem.cost);

    // Test 5: Zero coins deletes the Coins inventory item
    console.log("\nTest 5: Zero coins deletes the Coins inventory item...");
    await lua.doString(`
        DB.setValue("charsheet.id-00001.coins.slot1", "amount", "number", 0)
        DB.setValue("charsheet.id-00001.coins.slot2", "amount", "number", 0)
        local nodeChar = DB.findNode("charsheet.id-00001")
        computeCoins(nodeChar)
    `);
    const coinsItemAfterZero = await lua.doString(`
        local nodeChar = DB.findNode("charsheet.id-00001")
        return findCoinsItem(nodeChar)
    `);
    assertTest(coinsItemAfterZero === null || coinsItemAfterZero === undefined, "Coins item was deleted when quantity reduced to 0");

    // Test 6: upgradeDamnedCoinWeight imports amountA and deletes amountA
    console.log("\nTest 6: upgradeDamnedCoinWeight imports legacy data...");
    await lua.doString(`
        DB.setValue("charsheet.id-00001.coins.slot3", "name", "string", "cp")
        DB.setValue("charsheet.id-00001.coins.slot3", "amount", "number", 20)
        DB.setValue("charsheet.id-00001.coins.slot3", "amountA", "number", 30)
        local nodeSlot = DB.findNode("charsheet.id-00001.coins.slot3")
        upgradeDamnedCoinWeight(nodeSlot)
    `);
    const newAmount = await lua.doString(`return DB.getValue("charsheet.id-00001.coins.slot3", "amount", 0)`);
    const amountANode = await lua.doString(`return DB.findNode("charsheet.id-00001.coins.slot3.amountA")`);
    assertTest(newAmount === 50, "amount is upgraded to 20 + 30 = 50, got " + newAmount);
    assertTest(amountANode === null || amountANode === undefined, "amountA node was safely deleted");

    // Test 7: Feature-gated zeroing of CharEncumbranceManager.calcDefaultCurrencyEncumbrance (FGU)
    console.log("\nTest 7: FGU CharEncumbranceManager currency encumbrance zeroing...");
    await lua.doString(`
        CharEncumbranceManager = {
            calcDefaultCurrencyEncumbrance = function(nodeChar) return 15 end
        }
        onInit()
    `);
    const fguDefaultEnc = await lua.doString(`return CharEncumbranceManager.calcDefaultCurrencyEncumbrance(nil)`);
    assertTest(fguDefaultEnc === 0, "calcDefaultCurrencyEncumbrance was overridden to return 0 on FGU");

    // Test 8: FGC safety when CharEncumbranceManager is nil
    console.log("\nTest 8: FGC safety when CharEncumbranceManager is absent...");
    const fgcError = await lua.doString(`
        CharEncumbranceManager = nil
        local status, err = pcall(onInit)
        return status
    `);
    assertTest(fgcError === true, "onInit executes without error when CharEncumbranceManager is nil");

    // Test 9: /reload idempotency and handler registration
    console.log("\nTest 9: Handler registration and /reload idempotency...");
    const handlersBefore = await lua.doString(`return #db_handlers`);
    await lua.doString(`onInit()`);
    const handlersAfter = await lua.doString(`return #db_handlers`);
    assertTest(handlersBefore === handlersAfter, "Handlers are not duplicated on /reload (count: " + handlersAfter + ")");

    // Test 10: Safe node traversal in onCoinsValueChanged
    console.log("\nTest 10: Safe DB traversal on deleted or malformed coin nodes...");
    const crashTest = await lua.doString(`
        -- Test with non-existent node
        local status1, err1 = pcall(onCoinsValueChanged, nil)
        
        -- Test with orphaned node without parent
        local orphanNode = {
            _path = "some.random.path",
            getParent = function() return nil end,
            getChild = function() return nil end
        }
        local status2, err2 = pcall(onCoinsValueChanged, orphanNode)
        
        return status1 and status2
    `);
    assertTest(crashTest === true, "onCoinsValueChanged gracefully handles nil or orphaned nodes");

    console.log("\n========================================");
    console.log(`Results: ${passedTests} / ${totalTests} tests passed!`);
    console.log("========================================");

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
