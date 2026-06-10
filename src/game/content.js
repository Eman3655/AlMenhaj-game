import doorsList from "./content/doors.json";
import cardsList from "./content/cards.json";
import obstaclesList from "./content/obstacles.json";

import door01 from "./content/doors/door-01.json";
import door02 from "./content/doors/door-02.json";
import door03 from "./content/doors/door-03.json";
import door04 from "./content/doors/door-04.json";
import door05 from "./content/doors/door-05.json";
import door06 from "./content/doors/door-06.json";
import door07 from "./content/doors/door-07.json";
import door08 from "./content/doors/door-08.json";
import door09 from "./content/doors/door-09.json";
import door10 from "./content/doors/door-10.json";
import door11 from "./content/doors/door-11.json";
import door12 from "./content/doors/door-12.json";
import door13 from "./content/doors/door-13.json";
import door14 from "./content/doors/door-14.json";
import door15 from "./content/doors/door-15.json";
import door16 from "./content/doors/door-16.json";
import door17 from "./content/doors/door-17.json";
import door18 from "./content/doors/door-18.json";
import door19 from "./content/doors/door-19.json";
import door20 from "./content/doors/door-20.json";
import door21 from "./content/doors/door-21.json";
import door22 from "./content/doors/door-22.json";
import door23 from "./content/doors/door-23.json";
import door24 from "./content/doors/door-24.json";
import door25 from "./content/doors/door-25.json";
import door26 from "./content/doors/door-26.json";
import door27 from "./content/doors/door-27.json";
import door28 from "./content/doors/door-28.json";
import door29 from "./content/doors/door-29.json";
import door30 from "./content/doors/door-30.json";
import door31 from "./content/doors/door-31.json";
import door32 from "./content/doors/door-32.json";

const doorDetails = {
  "door-01": door01,
  "door-02": door02,
  "door-03": door03,
  "door-04": door04,
  "door-05": door05,
  "door-06": door06,
  "door-07": door07,
  "door-08": door08,
  "door-09": door09,
  "door-10": door10,
  "door-11": door11,
  "door-12": door12,
  "door-13": door13,
  "door-14": door14,
  "door-15": door15,
  "door-16": door16,
  "door-17": door17,
  "door-18": door18,
  "door-19": door19,
  "door-20": door20,
  "door-21": door21,
  "door-22": door22,
  "door-23": door23,
  "door-24": door24,
  "door-25": door25,
  "door-26": door26,
  "door-27": door27,
  "door-28": door28,
  "door-29": door29,
  "door-30": door30,
  "door-31": door31,
  "door-32": door32,
};

function makeDoor(baseDoor) {
  const details = doorDetails[baseDoor.id] || {};

  return {
    ...baseDoor,
    summary: details.summary || `أضف ملخص ${baseDoor.title}.`,
    illustration: details.illustration || "قراءة ← فهم ← عمل ← مراجعة",
    keyPoints: details.keyPoints?.length ? details.keyPoints : ["الفهم", "العمل", "المراجعة"],
    verses: details.verses || [],
    hadiths: details.hadiths || [],
    quiz: details.quiz?.prompt
      ? details.quiz
      : {
          prompt: `ما الفكرة الأساسية في ${baseDoor.title}؟`,
          options: ["الفهم والعمل", "تجاوز الباب بلا فهم", "حفظ العنوان فقط"],
          answerIndex: 0,
        },
    scenario: details.scenario?.prompt
      ? details.scenario
      : {
          prompt: `كيف يطبق الطالب معنى ${baseDoor.title}؟`,
          options: ["بالفهم والعمل", "بترك المراجعة", "بعدم الاهتمام"],
          answerIndex: 0,
        },
    mini: details.mini?.prompt
      ? details.mini
      : {
          prompt: "رتّب خطوات دراسة الباب:",
          items: ["قراءة", "فهم", "عمل", "مراجعة"],
          correct: ["قراءة", "فهم", "عمل", "مراجعة"],
        },
  };
}

export const DEFAULT_CONTENT = {
  doors: doorsList.map(makeDoor),
  cards: cardsList,
  obstacles: obstaclesList,
};