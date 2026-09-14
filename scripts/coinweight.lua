--
--	Please see the LICENSE.md file included with this distribution for attribution and copyright information.
--

-- Used for item name init and also finding the item, constant will never get out of sync.
COINS_INVENTORY_ITEM_NAME = 'Coins'

---	This function imports the data from the second column of coins used in damned's coins weight extension.
--	bmos also used this data structure in an early version of Total Encumbrance.
--	Once imported, the original database nodes are deleted.
function upgradeDamnedCoinWeight(nodeCoinSlot)
	local nCoinAmount = DB.getValue(nodeCoinSlot, 'amount', 0)
	local nCoinAmount2 = DB.getValue(nodeCoinSlot, 'amountA', 0)
	if nCoinAmount2 ~= 0 then
		DB.setValue(nodeCoinSlot, 'amount', 'number', nCoinAmount + nCoinAmount2)
		if DB.getValue(nodeCoinSlot, 'amountA') then
			local nodeAmountA = DB.getChild(nodeCoinSlot, 'amountA')
			if nodeAmountA then
				DB.deleteNode(nodeAmountA)
			end
		end
	end
end

---	This function rounds to the specified number of decimals
function round(number, decimals)
    local n = 10^(decimals or 0)
    number = number * n
    if number >= 0 then
		number = math.floor(number + 0.5)
	else
		number = math.ceil(number - 0.5)
	end

    return number / n
end

--- This function figures out how many decimal places to round to.
--	If the total weight is greater than or equal to 100, it recommends 0 (whole numbers).
--	If it's greater than or equal to 10, it recommends 1.
--	If it's greater than or equal to 1, it recommends 2.
--	Otherwise, it recommends 3.
--	This maximizes difficulty at low levels when it has the most impact.
--	The intent is to keep the number visible on the inventory list without clipping.
function determineRounding(nTotalCoinsWeight)
	if nTotalCoinsWeight >= 100 then
		return 0
	elseif nTotalCoinsWeight >= 10 then
		return 1
	elseif nTotalCoinsWeight >= 1 then
		return 2
	else
		return 3
	end
end

--	This function creates the "Coins" item in a PC's inventory.
--	It populates the name, type, and description and then returns the database node.
function createCoinsItem(nodeChar)
	local nodeCoinsItem
	if nodeChar and DB.getParent(nodeChar) and DB.getName(DB.getParent(nodeChar)) == 'charsheet' then
		local nodeInvList = DB.createChild(nodeChar, 'inventorylist')
		if nodeInvList then
			nodeCoinsItem = DB.createChild(nodeInvList)
			if nodeCoinsItem then
				DB.setValue(nodeCoinsItem, 'name', 'string', COINS_INVENTORY_ITEM_NAME)
				DB.setValue(nodeCoinsItem, 'type', 'string', 'Wealth and Money')
				local sDesc = (Interface and Interface.getString and Interface.getString("item_description_coins")) or "A standard coin weighs about a third of an ounce (50 to the pound)."
				DB.setValue(nodeCoinsItem, 'description', 'formattedtext', sDesc)
			end
		end
	end

	return nodeCoinsItem
end

---	This function looks for the "Coins" inventory item if it already exists.
---	Also matches "Coins (Coins Weight Extension)" for more context in name.
function findCoinsItem(nodeChar)
	for _,nodeItem in pairs(DB.getChildren(nodeChar, 'inventorylist')) do
		local sItemName = DB.getValue(nodeItem, 'name', '')
		if sItemName == COINS_INVENTORY_ITEM_NAME
		   or string.match(sItemName:lower(), '^%W*coins%W+coins%W+weight%W+extension%W*$') then
			return nodeItem
		end
	end
	return nil
end

---	This function writes the coin data to the database.
function writeCoinData(nodeChar, nTotalCoinsWeight, nTotalCoinsWealth)
	local nodeCoinsItem = findCoinsItem(nodeChar)
	if (nTotalCoinsWeight > 0 or nTotalCoinsWealth ~= 0) and not nodeCoinsItem then
		nodeCoinsItem = createCoinsItem(nodeChar)
	end
	local sWealth = tostring(nTotalCoinsWealth)
	if nTotalCoinsWealth == math.floor(nTotalCoinsWealth) then
		sWealth = tostring(math.floor(nTotalCoinsWealth))
	end
	if (nTotalCoinsWeight <= 0 and nTotalCoinsWealth == 0) and nodeCoinsItem then
		DB.deleteNode(nodeCoinsItem)
	elseif nTotalCoinsWeight < 0 and nodeCoinsItem then
		DB.setValue(nodeCoinsItem, 'cost', 'string', sWealth .. ' gp')
		DB.setValue(nodeCoinsItem, 'weight', 'number', 0) -- coins can't be negative weight
	elseif nodeCoinsItem then
		DB.setValue(nodeCoinsItem, 'cost', 'string', sWealth .. ' gp')
		DB.setValue(nodeCoinsItem, 'weight', 'number', round(nTotalCoinsWeight, determineRounding(nTotalCoinsWeight)))
	end
end

---	This function calculates the weight of all coins and their total value (in gp).
--	It looks at each coins database subnode and checks them for the data of other extensions.
--	Then, it checks their denominations against those defined in aDenominations or CurrencyManager.
--	If it doesn't find a match, it assumes a coin weight of .02.
function computeCoins(nodeChar)
	local nTotalCoinsWeight, nTotalCoinsWealth = 0, 0
	local aPaths = tCurrencyPaths or { "coins" }
	for _, sCurrencyPath in pairs(aPaths) do
		for _,nodeCoinSlot in pairs(DB.getChildren(nodeChar, sCurrencyPath)) do
			-- import data from other extensions
			upgradeDamnedCoinWeight(nodeCoinSlot)

			local nCoinAmount = DB.getValue(nodeCoinSlot, 'amount', 0)
			local sDenomination = string.lower(DB.getValue(nodeCoinSlot, 'name', ''))
			if sDenomination ~= '' then
				local bMatched = false
				if CurrencyManager and CurrencyManager.getCurrencyRecord then
					local tCurrency = CurrencyManager.getCurrencyRecord(sDenomination)
					if tCurrency then
						nTotalCoinsWealth = nTotalCoinsWealth + (nCoinAmount * (tCurrency['nValue'] or 0))
						nTotalCoinsWeight = nTotalCoinsWeight + (nCoinAmount * (tCurrency['nWeight'] or .02))
						bMatched = true
					end
				end
				if not bMatched then
					for sDenominationName,tDenominationData in pairs(aDenominations) do
						if string.match(sDenomination, string.lower(sDenominationName)) then
							nTotalCoinsWealth = nTotalCoinsWealth + (nCoinAmount * (tDenominationData['nValue'] or 0))
							nTotalCoinsWeight = nTotalCoinsWeight + (nCoinAmount * (tDenominationData['nWeight'] or .02))
							bMatched = true
							break
						end
					end
				end
				if not bMatched then
					nTotalCoinsWeight = nTotalCoinsWeight + (nCoinAmount * nDefaultCoinWeight)
				end
			else
				nTotalCoinsWeight = nTotalCoinsWeight + (nCoinAmount * nDefaultCoinWeight)
			end
		end
	end
	writeCoinData(nodeChar, nTotalCoinsWeight, nTotalCoinsWealth)
end

--	This function is called when a coin field is changed
function onCoinsValueChanged(nodeCoinData)
	local nodeChar = DB.getChild(nodeCoinData, '...')
	if nodeChar and DB.getParent(nodeChar) and DB.getName(DB.getParent(nodeChar)) == 'charsheet' then
		computeCoins(nodeChar)
	end
end

--	This function is called when a currency slot is removed
function onCoinsDeleted(nodeCoins)
	local nodeChar = DB.getParent(nodeCoins)
	if nodeChar and DB.getParent(nodeChar) and DB.getName(DB.getParent(nodeChar)) == 'charsheet' then
		computeCoins(nodeChar)
	end
end

---	On initializing, the script checks what the current ruleset is.
--	It then loads the correct denominations into the aDenominations table.
--	Then it configures a database node handler to watch for changes to coin data.
nDefaultCoinWeight = .02
aDenominations = {}
tCurrencyPaths = nil
local bHandlersInitialized = false

function onInit()
	-- Feature-gated zeroing of default currency encumbrance on modern FGU.
	-- Prevents double-counting by the ruleset without throwing nil errors on FGC.
	if CharEncumbranceManager and CharEncumbranceManager.calcDefaultCurrencyEncumbrance then
		CharEncumbranceManager.calcDefaultCurrencyEncumbrance = function() return 0 end
	end

	local sRuleset = User and User.getRulesetName and User.getRulesetName() or ""
	-- Set multipliers for different currency denominations.
	-- nValue = per-coin value multiplier. nWeight = per-coin weight multiplier (in pounds)
	if sRuleset == "3.5E" or sRuleset == "PFRPG" or sRuleset == "PFRPG2" then
		aDenominations['pp'] = { ['nValue'] = 10, ['nWeight'] = .02 }
		aDenominations['gp'] = { ['nValue'] = 1, ['nWeight'] = .02 }
		aDenominations['sp'] = { ['nValue'] = .1, ['nWeight'] = .02 }
		aDenominations['cp'] = { ['nValue'] = .01, ['nWeight'] = .02 }
	elseif sRuleset == "2E" or sRuleset == "5E" then
		aDenominations['pp'] = { ['nValue'] = 10, ['nWeight'] = .02 }
		aDenominations['gp'] = { ['nValue'] = 1, ['nWeight'] = .02 }
		aDenominations['ep'] = { ['nValue'] = .5, ['nWeight'] = .02 }
		aDenominations['sp'] = { ['nValue'] = .1, ['nWeight'] = .02 }
		aDenominations['cp'] = { ['nValue'] = .01, ['nWeight'] = .02 }
	elseif sRuleset == "4E" then
		aDenominations['ad'] = { ['nValue'] = 10000, ['nWeight'] = .002 }
		aDenominations['pp'] = { ['nValue'] = 100, ['nWeight'] = .02 }
		aDenominations['gp'] = { ['nValue'] = 1, ['nWeight'] = .02 }
		aDenominations['sp'] = { ['nValue'] = .1, ['nWeight'] = .02 }
		aDenominations['cp'] = { ['nValue'] = .01, ['nWeight'] = .02 }
	elseif sRuleset == "DFRPG" then
		aDenominations['copper'] = { ['nValue'] = 1, ['nWeight'] = .02 }
		aDenominations['silver'] = { ['nValue'] = 20, ['nWeight'] = .02 }
		aDenominations['gold'] = { ['nValue'] = 400, ['nWeight'] = .02 }
		aDenominations['platinum'] = { ['nValue'] = 800, ['nWeight'] = .02 }

		aDenominations['1/2 gold'] = { ['nValue'] = 200, ['nWeight'] = 0.01 }
		aDenominations['1/4 gold'] = { ['nValue'] = 100, ['nWeight'] = 0.005 }
		aDenominations['1/8 gold'] = { ['nValue'] = 50, ['nWeight'] = 0.0025 }

		aDenominations['billion'] = { ['nValue'] = 10, ['nWeight'] = .02 }
		aDenominations['tumbaga'] = { ['nValue'] = 60, ['nWeight'] = .02 }
		aDenominations['electrum'] = { ['nValue'] = 200, ['nWeight'] = .02 }
	elseif sRuleset == "GURPS DF" or sRuleset == "DF" then
		aDenominations['copper'] = { ['nValue'] = 1, ['nWeight'] = 0.016 }
		aDenominations['copper farthing'] = { ['nValue'] = 1, ['nWeight'] = 0.016 }
		aDenominations['farthing'] = { ['nValue'] = 1, ['nWeight'] = 0.016 }
		aDenominations['cf'] = { ['nValue'] = 1, ['nWeight'] = 0.016 }

		aDenominations['silver'] = { ['nValue'] = 4, ['nWeight'] = 0.004 }
		aDenominations['silver penny'] = { ['nValue'] = 4, ['nWeight'] = 0.004 }
		aDenominations['penny'] = { ['nValue'] = 4, ['nWeight'] = 0.004 }
		aDenominations['sp'] = { ['nValue'] = 4, ['nWeight'] = 0.004 }

		aDenominations['gold'] = { ['nValue'] = 80, ['nWeight'] = 0.004 }
		aDenominations['gold piece'] = { ['nValue'] = 80, ['nWeight'] = 0.004 }
		aDenominations['gp'] = { ['nValue'] = 80, ['nWeight'] = 0.004 }

		aDenominations['billon'] = { ['nValue'] = 10, ['nWeight'] = 0.02 }
		aDenominations['tumbaga'] = { ['nValue'] = 62, ['nWeight'] = 0.02 }
		aDenominations['electrum'] = { ['nValue'] = 210, ['nWeight'] = 0.02 }
		aDenominations['platinum'] = { ['nValue'] = 600, ['nWeight'] = 0.015625 }
	else
		if Debug and Debug.chat then
			Debug.chat("ruleset has no denominations defined in Coins Weight. If submitting denominations for inclusion, tell bmos ruleset name is: " .. sRuleset)
		end
	end

	-- Determine currency paths (support dynamic CurrencyManager in FGU, fallback to coins in FGC)
	if CurrencyManager and CurrencyManager.getCurrencyPaths then
		tCurrencyPaths = CurrencyManager.getCurrencyPaths('charsheet')
	end
	if not tCurrencyPaths or #tCurrencyPaths == 0 then
		tCurrencyPaths = { "coins" }
	end

	-- Safe host detection across FGC and FGU
	local bHost = (Session and Session.IsHost) or (User and User.isHost and User.isHost()) or false
	if bHost and not bHandlersInitialized then
		for _, sCurrencyPath in pairs(tCurrencyPaths) do
			DB.addHandler("charsheet.*." .. sCurrencyPath .. ".*", "onChildUpdate", onCoinsValueChanged)
			DB.addHandler("charsheet.*." .. sCurrencyPath, "onChildDeleted", onCoinsDeleted)
		end
		bHandlersInitialized = true
	end
end