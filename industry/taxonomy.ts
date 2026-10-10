// 这个行业的分类体系：类别、标签词表、机构（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 *
 * 排序原则：证据强度从高到低（指南 > 论文 > 机构 > 政策 > 器械 > 行业 > 科普），
 * `industry` 放在倒数第二位，作为未归类内容的兜底节。
 */
export const CATEGORIES = [
  {
    key: "guideline", label: "指南与共识", feedLabel: "康复指南与共识", section: "指南与共识",
    guide: "临床实践指南、专家共识、操作规范、康复路径、分级诊疗与转诊标准的发布或更新，含指南全文、要点解读和正式勘误。对指南方法学本身的研究（如 DELIS 质量评价）归论文研究，不是这一类。",
  },
  {
    key: "research", label: "论文研究", feedLabel: "康复论文与研究", section: "论文研究",
    guide: "以新研究方法、实验设计、样本与发现为核心的原创研究：RCT、系统综述与 Meta 分析、队列与病例对照、机制研究、量表与信效度验证、新数据集。预印本（medRxiv/bioRxiv）也归这一类，但要认它是未经同行评议的版本。临床病例报道只有带来可推广的结论时才归这里，单纯个案分享归行业动态。",
  },
  {
    key: "institution", label: "机构动态", feedLabel: "高校与医院动态", section: "机构动态",
    guide: "高校、医院、康复中心、实验室自己发布的成果、学科建设、门诊与技术开展、科研进展、人才培养与对外合作。判断依据是发布方是不是该机构本身；第三方媒体转述同一件事归行业动态。",
  },
  {
    key: "policy", label: "政策与执业", feedLabel: "政策与执业", section: "政策与执业",
    guide: "卫健、人社、医保、药监等部门的发文与解读，康复项目纳入医保、价格立项、执业范围与准入、职业资格与专业技术资格考试、继续教育学分、岗位招聘与就业政策。厂商自己的促销通知不算这一类，归设备与技术。",
  },
  {
    key: "device", label: "设备与技术", feedLabel: "康复设备与技术", section: "设备与技术",
    guide: "康复器械与软件的注册获批、技术原理与参数、临床验证数据、机器人/外骨骼/虚拟现实/远程康复等新工具，以及厂商的产品发布。有对照试验支撑的效果证据归论文研究；只有厂商单方说法、无第三方证据的归这一类但要按营销口径对待。",
  },
  {
    key: "industry", label: "行业动态", feedLabel: "康复行业动态", section: "行业动态",
    guide: "学会与协会的换届、专委会调整、学术会议与征文、奖项评选、行业统计、机构经营与合作、真实发生的医疗安全事件及其调查进展。也是未能明确归类内容的兜底节。",
  },
  {
    key: "education", label: "科普与教育", feedLabel: "康复科普", section: "科普与教育",
    guide: "面向患者与大众的疾病解释、居家训练、动作示范、误区澄清。作者是一线治疗师并给出可执行做法的仍归这一类；只有态度和预测、无具体做法的归观点。",
    commentary: true,
  },
  {
    key: "opinion", label: "观点与述评", feedLabel: "康复观点", section: "科普与教育",
    guide: "作者对学科方向、技术路线、行业现象的解释、判断、主张、预测、评论或访谈观点。写了具体做法就不属于这里；学会机构的正式立场文件归政策与执业。",
    commentary: true,
  },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布：日报报头的“N 项新指南”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "guideline", tag: "指南/共识", unit: "项新指南" };

/**
 * 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。
 * ⚠️ 必须全小写：reports/compose.ts 是把抽到的英文词 toLowerCase() 后再查这个集合的，
 * 写成 VAS / mRS / IASTM 会永远匹配不上。
 */
export const PLAIN_TERMS: readonly string[] = [
  "康复", "康复治疗", "康复医学", "物理治疗", "作业治疗", "言语治疗", "吞咽治疗", "心肺康复", "神经康复", "肌骨康复",
  "运动疗法", "手法治疗", "物理因子治疗", "日常生活能力", "生活质量", "不良反应", "禁忌证", "适应证", "循证",
  "adl", "rom", "mmt", "iastm", "rct", "meta", "vas", "nsaids",
  "mrs", "fugl-meyer", "berg", "barthel", "ashworth", "mmse", "moca",
];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 * 顺序即证据强度大致从高到低，评分权重依赖这个区分。
 */
export const ITEM_TYPES = [
  "guideline_release", // 指南、共识、规范、路径的发布或更新
  "research_paper", // 同行评议的原创研究、系统综述
  "preprint", // 未经同行评议的预印本
  "policy_release", // 政府部门的发文、资格与执业政策
  "institution_update", // 高校、医院、学会自身的动态
  "device_approval", // 器械与软件的注册获批、产品发布
  "training_program", // 面向从业者的培训、课程、招生
  "health_education", // 面向患者的科普与居家训练指导
  "opinion_analysis", // 述评、观点、访谈
] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "指南/共识", "论文/研究", "预印本", "政策/执业", "资格考试/认证", "招聘/就业", "继续教育学分", "机构动态", "学术会议",
  "器械/技术", "培训/课程", "科普/教育", "观点/述评", "行业动态", "非康复/通用医疗", "其他",
] as const;

/** 可选的主题标签（亚专科与技术方向）。 */
export const TOPIC_TAGS = [
  "神经康复", "脑卒中", "脊髓损伤", "颅脑创伤", "周围神经", "肌骨康复", "肩颈腰腿痛", "脊柱侧弯", "关节置换", "运动损伤",
  "前交叉韧带", "心肺康复", "儿童康复", "青少年体态", "老年康复", "跌倒预防", "疼痛管理", "手法治疗", "筋膜刀", "干针",
  "运动疗法", "抗阻训练", "平衡与核心", "呼吸训练", "物理因子治疗", "冲击波", "电刺激", "超声引导", "康复机器人", "外骨骼",
  "虚拟现实", "远程康复", "言语治疗", "吞咽治疗", "作业治疗", "认知康复", "盆底康复", "产后康复", "肿瘤康复", "淋巴水肿",
  "重症康复", "早期活动", "日常生活能力", "生活质量", "循证方法", "量表与评估",
] as const;

/** 可选的实体标签（学会、期刊、机构、厂商）。 */
export const ENTITY_TAGS = [
  "中国康复医学会", "中华医学会", "ISPRM", "ACRM", "WCPT", "WHO", "NATA", "ACSM", "NSCA",
  "JOSPT", "Archives of PM&R", "JRM", "Lancet", "Cochrane", "丁香园", "梅斯医学", "健康界",
] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  指南: "指南/共识", 共识: "指南/共识", 专家共识: "指南/共识", 规范: "指南/共识", 临床路径: "指南/共识", 操作标准: "指南/共识",
  论文: "论文/研究", 研究: "论文/研究", 文献: "论文/研究", paper: "论文/研究", papers: "论文/研究", 实验: "论文/研究", 临床试验: "论文/研究",
  系统综述: "论文/研究", "meta分析": "论文/研究", "meta 分析": "论文/研究", meta: "论文/研究", 综述: "论文/研究",
  预印本: "预印本", preprint: "预印本", "medrxiv": "预印本", "biorxiv": "预印本",
  政策: "政策/执业", 监管: "政策/执业", 法规: "政策/执业", 发文: "政策/执业", 医保: "政策/执业", 执业: "政策/执业",
  考试: "资格考试/认证", 资格: "资格考试/认证", 认证: "资格考试/认证", 考证: "资格考试/认证", 职称: "资格考试/认证",
  招聘: "招聘/就业", 就业: "招聘/就业", 岗位: "招聘/就业", 用人: "招聘/就业",
  继续教育: "继续教育学分", 学分: "继续教育学分", "I 类学分": "继续教育学分",
  学会: "机构动态", 协会: "机构动态", 医院: "机构动态", 高校: "机构动态", 院校: "机构动态", 机构: "机构动态",
  会议: "学术会议", 年会: "学术会议", 论坛: "学术会议", 征文: "学术会议", 学术活动: "学术会议",
  器械: "器械/技术", 设备: "器械/技术", 软件: "器械/技术", 机器人: "器械/技术", 外骨骼: "器械/技术", 注册: "器械/技术", 获批: "器械/技术", 产品: "器械/技术",
  培训: "培训/课程", 课程: "培训/课程", 招生: "培训/课程", 进修: "培训/课程", 工作坊: "培训/课程", workshop: "培训/课程",
  科普: "科普/教育", 患教: "科普/教育", 健康教育: "科普/教育", 居家训练: "科普/教育", 锻炼: "科普/教育",
  观点: "观点/述评", 述评: "观点/述评", 评论: "观点/述评", 社论: "观点/述评", 访谈: "观点/述评",
  行业: "行业动态", 动态: "行业动态", 人事: "行业动态", 合作: "行业动态", 融资: "行业动态", 并购: "行业动态", 奖项: "行业动态",
  非康复: "非康复/通用医疗", 通用医疗: "非康复/通用医疗", 临床医学: "非康复/通用医疗",
};

// ── 机构与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 机构主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是机构自己的其他称呼（官方账号名、子品牌、缩写），
 * 把事实的主体对到发布方时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  "carm": { name: "中国康复医学会", displayTag: "中国康复医学会", aliases: ["中国康复医学会", "CARM", "康复医学会"], otherNames: ["中国康复医学会物理治疗专委会", "中国康复医学会物理治疗专业委员会", "中国康复医学会康复工程与辅助技术专委会"] },
  "cma": { name: "中华医学会", displayTag: null, aliases: ["中华医学会", "CMA"], otherNames: ["中华医学网", "中华医学会杂志社"] },
  "isprm": { name: "ISPRM", displayTag: "ISPRM", aliases: ["ISPRM", "国际物理与康复医学会", "国际物理医学与康复学会"], otherNames: ["International Society of Physical and Rehabilitation Medicine"] },
  "acrm": { name: "ACRM", displayTag: null, aliases: ["ACRM", "美国康复医学学会"], otherNames: ["American Congress of Rehabilitation Medicine"] },
  "wcpt": { name: "WCPT", displayTag: null, aliases: ["WCPT", "世界物理治疗联盟"], otherNames: ["World Confederation for Physical Therapy"] },
  "who": { name: "WHO", displayTag: null, aliases: ["WHO", "世界卫生组织"] },
  "nata": { name: "NATA", displayTag: null, aliases: ["NATA", "美国运动防护师协会"], otherNames: ["National Athletic Trainers' Association"] },
  "acsm": { name: "ACSM", displayTag: null, aliases: ["ACSM", "美国运动医学会"], otherNames: ["American College of Sports Medicine"] },
  "nsca": { name: "NSCA", displayTag: null, aliases: ["NSCA", "美国国家体能协会"], otherNames: ["National Strength and Conditioning Association"] },
  "jospt": { name: "JOSPT", displayTag: null, aliases: ["JOSPT", "骨科与运动物理治疗杂志"], otherNames: ["Journal of Orthopaedic & Sports Physical Therapy"] },
  "archives-pmr": { name: "Archives of PM&R", displayTag: null, aliases: ["Archives of PM&R", "物理医学与康复杂志"], otherNames: ["American Journal of Physical Medicine & Rehabilitation"] },
  "jrm": { name: "JRM 康复医学杂志", displayTag: null, aliases: ["JRM", "Journal of Rehabilitation Medicine", "康复医学杂志"] },
  "cochrane": { name: "Cochrane", displayTag: null, aliases: ["Cochrane", "考科蓝", "循证卫生保健中心"], otherNames: ["Cochrane Library", "Cochrane Rehabilitation"] },
  "nmpa": { name: "国家药监局", displayTag: null, aliases: ["NMPA", "国家药品监督管理局", "药监局"] },
  "nhc": { name: "国家卫健委", displayTag: null, aliases: ["国家卫健委", "卫健委", "NHC"], otherNames: ["国家卫生健康委员会"] },
  "mohrss": { name: "人社部", displayTag: null, aliases: ["人社部", "人力资源和社会保障部"], otherNames: ["中华人民共和国人力资源和社会保障部"] },
  "dxy": { name: "丁香园", displayTag: null, aliases: ["丁香园", "丁香医生", "DXY"], otherNames: ["用药助手", "丁香通"] },
  "medsci": { name: "梅斯医学", displayTag: null, aliases: ["梅斯医学", "MedSci"] },
  "cn-healthcare": { name: "健康界", displayTag: null, aliases: ["健康界", "CN-Healthcare"] },
  "bsu": { name: "北京体育大学", displayTag: null, aliases: ["北体", "北体大", "北京体育大学"] },
  "sus": { name: "上海体育大学", displayTag: null, aliases: ["上体", "上体大", "上海体育大学", "上海体育学院"] },
};

/**
 * 身份词典：摘要和标题里出现的机构，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "carm", name: "中国康复医学会", patterns: [/中国康复医学会|\bcarm\b/i] },
  { id: "cma", name: "中华医学会", patterns: [/中华医学会|\bcma\b/i] },
  { id: "isprm", name: "ISPRM", patterns: [/\bisprm\b|国际物理与康复/i] },
  { id: "acrm", name: "ACRM", patterns: [/\bacrm\b|美国康复医学学会/i] },
  { id: "wcpt", name: "WCPT", patterns: [/\bwcpt\b|世界物理治疗联盟/i] },
  { id: "who", name: "WHO", patterns: [/\bwho\b|世界卫生组织/i] },
  { id: "nata", name: "NATA", patterns: [/\bnata\b|运动防护师协会/i] },
  { id: "acsm", name: "ACSM", patterns: [/\bacsm\b|美国运动医学会/i] },
  { id: "nsca", name: "NSCA", patterns: [/\bnsca\b|国家体能协会/i] },
  { id: "jospt", name: "JOSPT", patterns: [/\bjospt\b|骨科与运动物理治疗/i] },
  { id: "archives-pmr", name: "Archives of PM&R", patterns: [/archives[- ]pmr|archives of pm&r|物理医学与康复/i] },
  { id: "jrm", name: "JRM", patterns: [/\bjrm\b|journal of rehabilitation medicine|康复医学杂志/i] },
  { id: "cochrane", name: "Cochrane", patterns: [/cochrane|考科蓝/i] },
  { id: "nmpa", name: "国家药监局", patterns: [/nmpa|药品监督管理局|药监局/i] },
  { id: "nhc", name: "国家卫健委", patterns: [/卫健委|卫生健康委员会|\bnhc\b/i] },
  { id: "mohrss", name: "人社部", patterns: [/人社部|人力资源和社会保障/i] },
  { id: "dxy", name: "丁香园", patterns: [/丁香园|丁香医生|\bdxy\b/i] },
  { id: "medsci", name: "梅斯医学", patterns: [/梅斯|medsci/i] },
  { id: "cn-healthcare", name: "健康界", patterns: [/健康界/i] },
  { id: "bsu", name: "北京体育大学", patterns: [/北京体育大学|北体大?/i] },
  { id: "sus", name: "上海体育大学", patterns: [/上海体育(大学|学院)|上体大?/i] },
];

/** 原文里的这些写法也算提到了对应机构。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "carm", pattern: /中国康复医学会[\u4e00-\u9fa5]{0,12}专业委员会/i },
  { entityId: "cochrane", pattern: /\bCochrane\s+(Database\s+of\s+)?Systematic\s+Reviews\b/i },
];

/**
 * 原文里的这些域名上的文章，发布方就是对应的机构。
 * 聚合与托管平台不算（Europe PMC / PubMed 只是索引，文章发布方是期刊本身），所以这里不收 ebi.ac.uk。
 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "carm", domains: ["carm.org.cn"] },
  { entityId: "cma", domains: ["cma.org.cn", "yiigle.com"] },
  { entityId: "isprm", domains: ["isprm.org"] },
  { entityId: "acrm", domains: ["acrm.org"] },
  { entityId: "wcpt", domains: ["wcpt.org"] },
  { entityId: "who", domains: ["who.int"] },
  { entityId: "nata", domains: ["nata.org"] },
  { entityId: "acsm", domains: ["acsm.org"] },
  { entityId: "nsca", domains: ["nsca.com"] },
  { entityId: "jospt", domains: ["jospt.org"] },
  { entityId: "archives-pmr", domains: ["archives-pmr.org"] },
  { entityId: "jrm", domains: ["medicaljournals.se"] },
  { entityId: "cochrane", domains: ["cochranelibrary.com"] },
  { entityId: "nmpa", domains: ["nmpa.gov.cn"] },
  { entityId: "nhc", domains: ["nhc.gov.cn"] },
  { entityId: "mohrss", domains: ["mohrss.gov.cn"] },
  { entityId: "dxy", domains: ["dxy.cn"] },
  { entityId: "medsci", domains: ["medsci.cn"] },
  { entityId: "cn-healthcare", domains: ["cn-healthcare.com"] },
  { entityId: "bsu", domains: ["bsu.edu.cn"] },
  { entityId: "sus", domains: ["sus.edu.cn"] },
];
