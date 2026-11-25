# StockTransfer

## 原始資料標準化

安裝 Python 依賴套件：`python3 -m pip install 'openpyxl>=3.1,<4'`。

在專案目錄執行：

```bash
# 批次處理 RawData 內的 .xlsx 檔案
python3 normalize_rawdata.py

# 處理 RawData 內的單一檔案
python3 normalize_rawdata.py '調撥_202610.xlsx'

# 也可指定檔案路徑
python3 normalize_rawdata.py './RawData/調撥_202610.xlsx'
```

處理會覆寫原檔；將「未設定」轉為數值 0，藥品代碼與藥品名稱保留為文字，其他欄位轉為整數。遇到空白、小數、公式或無法安全轉換的資料時，列出位置並跳過該檔；其他檔案繼續處理。完全空白的資料列會略過。

## 匯入藥庫調撥資料

先完成原始資料標準化，檔名須為 `調撥_YYYYMM.xlsx`，且每個檔案包含一個工作表。

```bash
python3 import_stock_transfer.py                     # 匯入 RawData 全部月份
python3 import_stock_transfer.py '調撥_202610.xlsx'  # 匯入單月
python3 import_stock_transfer.py './RawData/調撥_202610.xlsx'
```

結果儲存於專案目錄的 `stock_transfer.db`，資料表為 `stock_transfer`；`import_history` 記錄每月最後匯入結果，包括零筆月份。調撥月份為 `YYYYMM` 整數，識別欄位為六位月份直接串接藥品代碼。每月檢查後以交易取代該月，失敗則保留既有資料，其他月份繼續。檔案必須至少有一筆指定欄位皆非空白的資料列；調藥次數為零的資料只檢查次數。若有效資料均為零，會清除該月舊資料。資料庫不納入 Git。
