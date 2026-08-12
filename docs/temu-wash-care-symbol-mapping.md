# TEMU 洗护标志映射关系

来源：

- `/Users/xingyicheng/Downloads/TEMU洗唛符号人工校准表.xlsx`
- `/Users/xingyicheng/Downloads/人工校准梳理-LZH0812.xlsx`：人工图标对照表，覆盖 9 个高频项：手洗 40℃、30℃常规洗、不可漂白、悬挂晾干、平摊晾干、阴凉处悬挂晾干、低温熨烫、不可熨烫、不可干洗
- 2026-08-12 通过已登录 TEMU 后台 `https://agentseller.temu.com/goods/label` 前端 `product-label` bundle 核查的五类枚举
- 2026-08-12 通过 TEMU 洗水唛编辑抽屉核查字段：洗涤、漂白、干燥、熨烫、专业护理，对应接口字段 `washing`、`bleaching`、`drying`、`ironing`、`dryCleaning`
- 2026-08-12 通过 SCM `https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index` 洗唛批复判定页核查数据来源字段：洗唛文件、中文成分、英文成分、判定结果、判定备注
- SCM 洗唛源图人工核对：方框竖线为悬挂晾干，方框横线为平摊晾干，熨斗打叉为不可熨烫

## 关键纠偏

- `drying=4` 是 `D01 悬挂晾干 / line drying`。
- `drying=8` 是 `D03 平摊晾干 / flat drying`。
- `ironing=3` 是 TEMU 当前低温熨烫项：`120℃，蒸汽可能造成不可恢复损伤`。
- `ironing=4` 是 `I04 不可熨烫 / do not iron`。
- SCM 文案只缺某一项时，程序只对缺失项用默认值兜底，不能整组覆盖已经识别正确的其他符号。
- 历史错例 `208326104202` 和截图款 `208326101201` 都属于同类问题：SCM/源图应为平摊晾干，但 TEMU 编辑页被写成悬挂晾干；其中一个触发点是熨烫项未命中后旧逻辑整组回退。

## 程序使用规则

- 优先使用 SCM 判定备注或洗唛附件 AI/OCR 识别出的洗护说明，按下方表格逐项映射。
- AI/OCR 多模态识别提示会内置 `人工校准梳理-LZH0812.xlsx` 的 9 个高频图标样例，要求模型直接返回 TEMU `careSymbols` 枚举值。
- 五类中只要有某一类识别成功，就保留该类映射；仅对缺失类使用默认兜底。
- 默认兜底为：`washing=13` 手洗 40℃、`bleaching=3` 不可漂白、`drying=4` 悬挂晾干、`ironing=3` 低温熨烫、`dryCleaning=5` 不可干洗。
- TEMU 页面英文里存在历史/平台拼写差异，例如 `protessional`，程序匹配时兼容页面原文和常见正确拼写。

## 完整映射

| 类别 | TEMU字段 | TEMU值 | 标准ID | TEMU英文/页面文字 | TEMU中文 |
|---|---|---:|---|---|---|
| 洗涤 | washing | 1 | W12 | maximum temperature 95 ℃, normal process | 最高洗涤温度95℃ 常规程序 |
| 洗涤 | washing | 2 | W11 | maximum temperature 70 ℃, normal process | 最高洗涤温度70℃ 常规程序 |
| 洗涤 | washing | 3 | W09 | maximum temperature 60 ℃, normal process | 最高洗涤温度60℃ 常规程序 |
| 洗涤 | washing | 4 | W10 | maximum temperature 60 ℃, mild process | 最高洗涤温度60℃ 缓和程序 |
| 洗涤 | washing | 5 | W13 | maximum temperature 50 ℃, normal process | 最高洗涤温度50℃ 常规程序 |
| 洗涤 | washing | 6 | W14 | maximum temperature 50 ℃, mild process | 最高洗涤温度50℃ 缓和程序 |
| 洗涤 | washing | 7 | W06 | maximum temperature 40 ℃, normal process | 最高洗涤温度40℃ 常规程序 |
| 洗涤 | washing | 8 | W07 | maximum temperature 40 ℃, mild process | 最高洗涤温度40℃ 缓和程序 |
| 洗涤 | washing | 9 | W08 | maximum temperature 40 ℃, very mild process | 最高洗涤温度40℃ 非常缓和程序 |
| 洗涤 | washing | 10 | W03 | maximum temperature 30 ℃, normal process | 最高洗涤温度30℃ 常规程序 |
| 洗涤 | washing | 11 | W04 | maximum temperature 30 ℃, mild process | 最高洗涤温度30℃ 缓和程序 |
| 洗涤 | washing | 12 | W05 | maximum temperature 30 ℃, very mild process | 最高洗涤温度30℃ 非常缓和程序 |
| 洗涤 | washing | 13 | W01 | hand wash, maximum temperature 40 ℃ | 最高洗涤温度 40°C 手洗 |
| 洗涤 | washing | 15 | W15 | hand wash, ambient temperature | 常温 手洗 |
| 洗涤 | washing | 14 | W02 | do not wash | 不可水洗 |
| 漂白 | bleaching | 1 | B01 | any bleaching agent allowed | 允许任何漂白剂 |
| 漂白 | bleaching | 2 | B02 | only oxygen /non-chlorine bleach allowed | 仅允许氧漂/非氯漂 |
| 漂白 | bleaching | 3 | B03 | do not bleach | 不可漂白 |
| 干燥 | drying | 1 | D09 | tumble drying possible, normal temperature, exhaust temperature max. 80 ℃ | 可使用翻转干燥，常规温度，排气口最高温度80°C |
| 干燥 | drying | 2 | D10 | tumble drying possible, normal temperature, exhaust temperature max. 60 ℃ | 可使用翻转干燥，较低温度，排气口最高温度60°C |
| 干燥 | drying | 3 | D11 | do not tumble dry | 不可翻转干燥 |
| 干燥 | drying | 4 | D01 | line drying | 悬挂晾干 |
| 干燥 | drying | 5 | D05 | line drying in the shade | 在阴凉处悬挂晾干 |
| 干燥 | drying | 6 | D02 | drip line drying | 悬挂滴干 |
| 干燥 | drying | 7 | D06 | drip line drying in the shade | 在阴凉处悬挂滴干 |
| 干燥 | drying | 8 | D03 | flat drying | 平摊晾干 |
| 干燥 | drying | 9 | D07 | flat drying in the shade | 在阴凉处平摊晾干 |
| 干燥 | drying | 10 | D04 | drip flat drying | 平摊滴干 |
| 干燥 | drying | 11 | D08 | drip flat drying in the shade | 在阴凉处平摊滴干 |
| 熨烫 | ironing | 1 | I05 | iron at a maximal sole plate temperature of 210 ℃ | 熨烫底板最高温度210℃ |
| 熨烫 | ironing | 2 | I06 | iron at a maximal sole plate temperature of 160 ℃ | 熨斗底板最高温度160 ℃ |
| 熨烫 | ironing | 3 | I07 | iron at a maximal sole plate temperature of 120 ℃, steam iron may cause irreversible damage | 熨斗底板最高温度120℃，蒸汽熨烫可能造成不可回复的损伤 |
| 熨烫 | ironing | 4 | I04 | do not iron | 不可熨烫 |
| 熨烫 | ironing | 5 | I08 | iron at a maximum sole plate temperature of 120 ℃ without steam | 熨斗底板最高温度120℃，不可蒸汽熨烫 |
| 专业护理 | dryCleaning | 1 | P01 | professional dry cleaning in tetrachloroethene, DBM and F solvents, normal process | 使用四氯乙烯、二丁氧基甲烷和符号F所代表的所有溶剂的专业干洗，常规干洗 |
| 专业护理 | dryCleaning | 2 | P02 | professional dry cleaning in tetrachloroethene, DBM and F solvents, mild process | 使用四氯乙烯、二丁氧基甲烷和符号F所代表的所有溶剂的专业干洗，缓和干洗 |
| 专业护理 | dryCleaning | 21 | P10 | professional dry cleaning in tetrachloroethene, DBM and F solvents, very mild process | 使用四氯乙烯、二丁氧基甲烷和符号F所代表的所有溶剂的专业干洗，非常缓和干洗 |
| 专业护理 | dryCleaning | 3 | P03 | professional dry cleaning in hydrocarbons, normal process | 使用碳氢化合物溶剂的专业干洗，常规干洗 |
| 专业护理 | dryCleaning | 4 | P04 | professional dry cleaning in hydrocarbons, mild process | 使用碳氢化合物溶剂的专业干洗，缓和干洗 |
| 专业护理 | dryCleaning | 5 | P05 | do not dry clean, No professional dry cleaning allowed | 不可干洗，不可专业干洗 |
| 专业护理 | dryCleaning | 6 | P06 | professional wet cleaning, normal process | 专业湿洗，常规湿洗 |
| 专业护理 | dryCleaning | 7 | P07 | professional wet cleaning, mild process | 专业湿洗，缓和湿洗 |
| 专业护理 | dryCleaning | 8 | P08 | professional wet cleaning, very mild process | 专业湿洗，非常缓和湿洗 |
| 专业护理 | dryCleaning | 9 | P09 | do not wet clean, no professional wet cleaning allowed | 不可湿洗，不可专业湿洗 |
