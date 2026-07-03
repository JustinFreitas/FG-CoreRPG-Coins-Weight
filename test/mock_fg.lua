-- test/mock_fg.lua

-- Node definition
local allNodes = {}
local idCounter = 0

local NodeMethods = {
    getParent = function(self)
        return self.parent
    end,
    getName = function(self)
        return self.path:match("([^.]+)$") or self.path
    end,
    getNodeName = function(self)
        return self.path
    end,
    getChild = function(self, subpath)
        if not subpath then return nil end
        if subpath == "..." then
            if self.parent then
                return self.parent.parent
            end
            return nil
        elseif subpath == ".." then
            return self.parent
        elseif subpath == "." then
            return self
        end
        
        if subpath:find("%.") then
            local parts = {}
            for part in subpath:gmatch("[^%.]+") do
                table.insert(parts, part)
            end
            local current = self
            for _, part in ipairs(parts) do
                if not current then break end
                current = current:getChild(part)
            end
            return current
        end
        return self.children[subpath]
    end,
    delete = function(self)
        if self.parent then
            local name = self:getName()
            self.parent.children[name] = nil
        end
        allNodes[self.path] = nil
        local function recDelete(n)
            for _, child in pairs(n.children) do
                allNodes[child.path] = nil
                recDelete(child)
            end
        end
        recDelete(self)
    end
}

Node = {}
function Node.new(path, parent)
    local self = setmetatable({}, {
        __index = function(tbl, key)
            local method = NodeMethods[key]
            if method then
                return function(firstArg, ...)
                    if firstArg == tbl then
                        return method(tbl, ...)
                    else
                        return method(tbl, firstArg, ...)
                    end
                end
            end
            return tbl[key]
        end
    })
    self.path = path
    self.parent = parent
    self.children = {}
    self.value = nil
    self.type = nil
    allNodes[path] = self
    return self
end

-- DB API
DB = {
    handlers = {}
}

function DB.createChild(node, name)
    if not node then return nil end
    if not name then
        idCounter = idCounter + 1
        name = string.format("id-%05d", idCounter)
    end
    if not node.children[name] then
        local childPath = node.path .. "." .. name
        node.children[name] = Node.new(childPath, node)
    end
    return node.children[name]
end

function DB.setValue(node, subpath, type, value, val2)
    if not node then return end
    local targetNode = node
    if subpath and subpath ~= "" then
        targetNode = DB.createChild(node, subpath)
    end
    targetNode.type = type
    if type == "windowreference" then
        targetNode.value = { value, val2 }
    else
        targetNode.value = value
    end
end

function DB.getValue(node, subpath, default)
    if not node then return default end
    
    local child
    if not subpath or subpath == "" then
        child = node
    else
        child = node:getChild(subpath)
    end
    
    if not child or child.value == nil then
        return default
    end
    if child.type == "windowreference" then
        return child.value[1], child.value[2]
    else
        return child.value
    end
end

function DB.findNode(path)
    return allNodes[path]
end

function DB.getChildren(node, subpath)
    if not node then return {} end
    if subpath and subpath ~= "" then
        local child = node:getChild(subpath)
        if not child then return {} end
        return child.children
    else
        return node.children
    end
end

function DB.addHandler(path, event, callback)
    table.insert(DB.handlers, { path = path, event = event, callback = callback })
end

function DB.removeHandler(path, event, callback)
    for i, handler in ipairs(DB.handlers) do
        if handler.path == path and handler.event == event and handler.callback == callback then
            table.remove(DB.handlers, i)
            break
        end
    end
end

function DB.trigger(event, path, ...)
    for _, handler in ipairs(DB.handlers) do
        if handler.event == event then
            local handlerPath = handler.path
            local matchesDescendants = false
            if handlerPath:sub(-1) == "." then
                handlerPath = handlerPath:sub(1, -2)
                matchesDescendants = true
            end
            
            -- convert FG wildcard path to Lua regex pattern
            local pattern = "^" .. handlerPath:gsub("%.", "%%."):gsub("%*", ".-")
            if matchesDescendants then
                pattern = pattern .. ".*$"
            else
                pattern = pattern .. "$"
            end
            
            local matched = path:match(pattern)
            if matched then
                handler.callback(...)
            end
        end
    end
end

-- Root Nodes
charsheetNode = Node.new("charsheet", nil)
currenciesNode = Node.new("currencies", nil)

-- Helper to reset DB
function DB.reset()
    allNodes = {}
    idCounter = 0
    DB.handlers = {}
    charsheetNode = Node.new("charsheet", nil)
    currenciesNode = Node.new("currencies", nil)
end

-- Interface API
Interface = {}
function Interface.getString(key)
    if key == "item_description_coins" then
        return "This is a record of your coins weight and wealth."
    end
    return ""
end

-- ItemManager API
ItemManager = {}
function ItemManager.getInventoryPaths(sheet)
    if sheet == "charsheet" then
        return { "inventorylist" }
    end
    return {}
end

-- CurrencyManager API
CurrencyManager = {
    CAMPAIGN_CURRENCY_LIST = "currencies",
    currencies = {
        gp = { nValue = 1, nWeight = 0.02 },
        sp = { nValue = 0.1, nWeight = 0.02 },
        cp = { nValue = 0.01, nWeight = 0.02 },
        ep = { nValue = 0.5, nWeight = 0.02 },
        pp = { nValue = 10, nWeight = 0.02 }
    }
}
function CurrencyManager.getCurrencyPaths(sheet)
    if sheet == "charsheet" then
        return { "coins" }
    end
    return {}
end
function CurrencyManager.getCurrencyRecord(sDenomination)
    return CurrencyManager.currencies[sDenomination]
end

-- CharEncumbranceManager API
CharEncumbranceManager = {
    calcDefaultCurrencyEncumbrance = function()
        return 10
    end
}

-- Session API
Session = {
    IsHost = true
}

-- Simulators for database updates
function simulateUpdateCoin(charId, slotId, name, amount)
    local charNode = DB.findNode("charsheet." .. charId)
    if not charNode then
        charNode = DB.createChild(DB.findNode("charsheet"), charId)
        DB.createChild(charNode, "inventorylist")
    end
    local coinsNode = DB.createChild(charNode, "coins")
    local slotNode = DB.createChild(coinsNode, slotId)
    DB.setValue(slotNode, "name", "string", name)
    DB.setValue(slotNode, "amount", "number", amount)
    
    DB.trigger("onChildUpdate", "charsheet." .. charId .. ".coins." .. slotId, slotNode)
end

function simulateDeleteCoin(charId, slotId)
    local charNode = DB.findNode("charsheet." .. charId)
    local coinsNode = charNode:getChild("coins")
    local slotNode = coinsNode:getChild(slotId)
    if slotNode then
        slotNode:delete()
    end
    
    DB.trigger("onChildDeleted", "charsheet." .. charId .. ".coins", coinsNode)
end
