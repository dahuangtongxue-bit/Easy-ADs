// 选角台：预置数字人名单（火山虚拟人像库里已审核通过的官方 AIGC 虚拟人）。
// 排序规则：女性在前、男性在后，各自按年龄从小到大。
// 每个自带 asset_id + 现成的外观描述（desc 会直接当「外观锚点」喂给分镜大脑，用户可改）。
// 想上新：切一张 3:4 头像放 public/cast/、在这里按排序规则插一条即可。

export type CastPreset = {
  assetId: string;
  img: string; // public 下的头像路径
  label: string; // 卡片下的小标签（性别·年龄·职业）
  desc: string; // 外观描述（分镜的外观锚点，可被用户编辑）
};

export const CAST_PRESETS: CastPreset[] = [
  // ===== 女 =====
  { assetId: "asset-20260224225904-v6sf2", img: "/cast/cast-v6sf2.jpg", label: "女20 · 模特", desc: "黑色脏辫长发、穿红蓝拼接牛仔外套白色内搭的年轻中国女性" },
  { assetId: "asset-20260224200411-vwxw8", img: "/cast/cast-vwxw8.jpg", label: "女20 · 火锅店员", desc: "扎高马尾、穿深蓝色工作服系碎花领巾的年轻中国女性" },
  { assetId: "asset-20260224200527-7pg5w", img: "/cast/cast-7pg5w.jpg", label: "女20 · 歌手", desc: "黑色中长发、穿米蓝竖条纹衬衫的年轻中国女性" },
  { assetId: "asset-20260224225803-ftdx6", img: "/cast/cast-ftdx6.jpg", label: "女22 · 模特(欧)", desc: "金色长直发、穿浅绿色衬衫的年轻欧洲女性" },
  { assetId: "asset-20260224194603-nrn7x", img: "/cast/cast-nrn7x.jpg", label: "女23 · 大学生(欧)", desc: "红棕色卷发带雀斑、穿黑色T恤的年轻西班牙女性" },
  { assetId: "asset-20260224200620-8c29c", img: "/cast/13.png", label: "女23 · 律师", desc: "黑色低马尾、穿白衬衫黑色西装外套的年轻中国女性" },
  { assetId: "asset-20260720204929-26lxr", img: "/cast/21.png", label: "女24 · 返乡花农(日)", desc: "黑色高马尾、穿浅蓝色牛仔背带裤的年轻日本女性" },
  { assetId: "asset-20260401123823-6d4x2", img: "/cast/cast-6d4x2.jpg", label: "女26 · 主播", desc: "黑色长直发中分、穿米白色上衣的年轻中国女性" },
  { assetId: "asset-20260224225650-xgr48", img: "/cast/cast-xgr48.jpg", label: "女26 · 快递员", desc: "扎马尾、穿橙黑撞色快递工装的年轻中国女性" },
  { assetId: "asset-20260224200637-wxgn8", img: "/cast/14.png", label: "女27 · 模特", desc: "黑色大波浪长发、穿香槟色缎面吊带裙的年轻中国女性" },
  { assetId: "asset-20260224200822-gpxm8", img: "/cast/24.png", label: "女29 · 普拉提教练", desc: "扎高丸子头身形挺拔、穿藕灰色瑜伽服的年轻中国女性" },
  { assetId: "asset-20260720212130-vnnm5", img: "/cast/17.png", label: "女31 · 产品经理", desc: "黑色齐颈短发、穿黑色高领毛衣的青年中国女性" },
  { assetId: "asset-20260720210733-kqcvm", img: "/cast/20.png", label: "女32 · 居委会主任(韩)", desc: "黑色齐耳短发、穿枣红色开衫的青年韩国女性" },
  { assetId: "asset-20260720211206-wmj2r", img: "/cast/19.png", label: "女33 · 公关总监", desc: "黑色低发髻珍珠耳饰、穿白色丝质衬衫的青年中国女性" },
  { assetId: "asset-20260720211012-lrfct", img: "/cast/15.png", label: "女34 · 产品经理", desc: "扎利落低马尾、穿灰色西装外套白色内搭的中年中国女性" },
  { assetId: "asset-20260224201256-vnfvp", img: "/cast/18.png", label: "女36 · 心理咨询师", desc: "黑色盘发插木簪、穿亚麻色棉麻长衫的中年中国女性" },
  { assetId: "asset-20260720205825-cgj4k", img: "/cast/16.png", label: "女37 · 数据分析师", desc: "黑色齐肩发戴细框眼镜、穿米色针织衫的中年中国女性" },
  { assetId: "asset-20260720205351-xc4cc", img: "/cast/22.png", label: "女38 · 投行精英", desc: "黑色一丝不苟盘发、穿黑色西装套装的中年中国女性" },
  { assetId: "asset-20260720213625-hsv22", img: "/cast/23.png", label: "女39 · 寻亲志愿者", desc: "黑色温婉齐肩卷发、穿藕粉色针织衫的中年中国女性" },
  { assetId: "asset-20260224201307-fm8lg", img: "/cast/cast-fm8lg.jpg", label: "女43 · 护工", desc: "梳侧麻花辫、穿橙色圆领上衣的中年中国女性" },
  { assetId: "asset-20260224201137-6zwrf", img: "/cast/cast-6zwrf.jpg", label: "女44 · 护士", desc: "极短寸头戴圆耳环、穿白色护士服的中年中国女性" },
  { assetId: "asset-20260224201115-w5frq", img: "/cast/cast-w5frq.jpg", label: "女55 · 医生", desc: "灰黑色齐肩卷发、穿白大褂的中年中国女性" },
  { assetId: "asset-20260310032630-lt692", img: "/cast/cast-lt692.jpg", label: "女58 · 会计", desc: "利落短发、穿深蓝西装外套白色内搭的中年中国女性" },
  { assetId: "asset-20260224225710-qd85p", img: "/cast/cast-qd85p.jpg", label: "女73 · 演员", desc: "银白色短发、穿香槟色缎面旗袍上衣的中国老年女性" },
  // ===== 男 =====
  { assetId: "asset-20260224201724-wlldp", img: "/cast/cast-wlldp.jpg", label: "男20 · 修理工", desc: "光头圆脸、穿黑色T恤的年轻中国男性" },
  { assetId: "asset-20260224201540-r8rfq", img: "/cast/cast-r8rfq.jpg", label: "男20 · 挖机司机", desc: "黑色寸头、穿蓝色工装衬衫的年轻中国男性" },
  { assetId: "asset-20260224203245-rd78f", img: "/cast/cast-rd78f.jpg", label: "男20 · 快递员(法)", desc: "黑色小脏辫、穿红色polo衫的年轻非裔法国男性" },
  { assetId: "asset-20260224201705-ld6rg", img: "/cast/cast-ld6rg.jpg", label: "男20 · 屠夫(中亚)", desc: "黑色短发偏分、穿深灰蓝T恤的年轻中亚男性" },
  { assetId: "asset-20260224201845-z5wnw", img: "/cast/12.png", label: "男20 · 创业CEO", desc: "黑色清爽短发、穿白色衬衫挽起袖口的年轻中国男性" },
  { assetId: "asset-20260224225750-8w69j", img: "/cast/cast-8w69j.jpg", label: "男23 · 设计师(欧)", desc: "棕色短发、穿浅蓝色工装衬衫的年轻欧洲男性" },
  { assetId: "asset-20260224201712-bqn6l", img: "/cast/4.png", label: "男23 · 文创CEO", desc: "黑色微卷短发、穿米白色立领盘扣上衣的年轻中国男性" },
  { assetId: "asset-20260224201619-rxxdr", img: "/cast/5.png", label: "男24 · 工程师", desc: "黑色平头戴黑框眼镜、穿浅蓝色衬衫的年轻中国男性" },
  { assetId: "asset-20260224225640-2hw8q", img: "/cast/cast-2hw8q.jpg", label: "男25 · 外卖员", desc: "黑色短发、穿蓝黑拼色骑手polo衫的年轻中国男性" },
  { assetId: "asset-20260224201647-bwdll", img: "/cast/8.png", label: "男25 · 工程师(韩)", desc: "黑色齐眉短发、穿白色衬衫系深蓝色领带的年轻韩国男性" },
  { assetId: "asset-20260320094231-ps8mn", img: "/cast/9.png", label: "男28 · 设计师", desc: "黑色中分微长发、穿黑色圆领T恤的年轻中国男性" },
  { assetId: "asset-20260224201752-jmzks", img: "/cast/11.png", label: "男31 · 设计师", desc: "黑色蓬乱短发、穿军绿色工装外套的青年中国男性" },
  { assetId: "asset-20260224201749-c49tq", img: "/cast/7.png", label: "男33 · 工程师", desc: "黑色短发、穿灰色polo衫挂工牌的青年中国男性" },
  { assetId: "asset-20260720203811-h2rtj", img: "/cast/3.png", label: "男34 · 科技CEO", desc: "黑色利落短发、穿藏青色西装内搭黑T恤的青年中国男性" },
  { assetId: "asset-20260224201903-rnqpn", img: "/cast/6.png", label: "男34 · 工程师(印尼)", desc: "黑色短卷发、穿卡其色工装衬衫的中年印度尼西亚男性" },
  { assetId: "asset-20260720211925-vsjg2", img: "/cast/2.png", label: "男35 · 科技CEO", desc: "黑色短发眼下微青、穿深灰色连帽卫衣的青年中国男性" },
  { assetId: "asset-20260224202106-jhsl6", img: "/cast/10.png", label: "男36 · 设计师", desc: "黑色寸头蓄胡茬、穿深红色民族纹样衬衫的中年中国男性" },
  { assetId: "asset-20260804202330-bps7t", img: "/cast/1.png", label: "男37 · 内阁首辅(古装)", desc: "蓄短须束发戴乌纱帽、穿绯红色圆领仙鹤补服的中年中国男性" },
  { assetId: "asset-20260224225638-nfdps", img: "/cast/cast-nfdps.jpg", label: "男38 · 快递员", desc: "黑色短发、穿橙黑撞色快递工装的中国男性" },
  { assetId: "asset-20260224230000-qfwqm", img: "/cast/cast-qfwqm.jpg", label: "男38 · 小贩(东南亚)", desc: "黑色短发、穿卡其色衬衫的东南亚男性" },
  { assetId: "asset-20260320094619-ww8fl", img: "/cast/cast-ww8fl.jpg", label: "男46 · 搬运工", desc: "花白短发带胡茬、穿破旧灰色T恤的中年中国男性" },
  { assetId: "asset-20260224202201-fnhs4", img: "/cast/cast-fnhs4.jpg", label: "男53 · 外科医生", desc: "灰白短发戴黑框眼镜、穿白大褂粉衬衫的中年中国男性" },
  { assetId: "asset-20260224225614-dkbmk", img: "/cast/cast-dkbmk.jpg", label: "男55 · 主播", desc: "黑色短发、穿黑色西装配红色领带的中年中国男性" },
  { assetId: "asset-20260224202246-h2brs", img: "/cast/cast-h2brs.jpg", label: "男89 · 退休", desc: "满头白发戴眼镜、穿卡其色夹克的中国老年男性" },
];
