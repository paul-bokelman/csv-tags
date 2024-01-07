import fs from "fs";
import util from "util";
import { exec } from "child_process";
import { parse } from "csv";
import { select, confirm, input, checkbox } from "@inquirer/prompts";

const default_tags = ["sports", "science", "reading", "math", "history", "culture", "nature", "social", "charity"];

(async () => {
  let local_tags: string[] = default_tags;

  if (fs.existsSync("./local-tags.json")) {
    const tags: string[] = JSON.parse(await fs.promises.readFile("./local-tags.json", "utf-8"));
    local_tags = tags;
  } else {
    await fs.promises.writeFile("./local-tags.json", JSON.stringify(default_tags));
  }

  console.log("Local tags:", local_tags.join(", "));

  const modify_tags = await confirm({
    message: "Modify tags? (y/n)",
    default: false,
  });

  if (modify_tags) {
    const reset_tags = await confirm({
      message: "Restore default tags? (y/n)",
      default: false,
    });

    if (reset_tags) {
      local_tags = default_tags;
      await fs.promises.writeFile("./local-tags.json", JSON.stringify(local_tags));
    }

    const remove_tags = await confirm({
      message: "Remove tags? (y/n)",
      default: false,
    });

    if (remove_tags) {
      const tags_to_remove = await checkbox({
        message: "Choose tags to remove",
        choices: local_tags.map((tag) => ({ name: tag, value: tag })),
        instructions: false,
        pageSize: local_tags.length,
      });
      local_tags = local_tags.filter((tag) => !tags_to_remove.includes(tag));
      await fs.promises.writeFile("./local-tags.json", JSON.stringify(local_tags));
    }

    const add_tags = await confirm({
      message: "Add tags? (y/n)",
      default: false,
    });

    if (add_tags) {
      const new_tags = await input({ message: "Enter tags separated by commas:" });
      local_tags = [...local_tags, ...new_tags.split(",")];
      await fs.promises.writeFile("./local-tags.json", JSON.stringify(local_tags));
    }
  }

  const files = await fs.promises.readdir("./data");
  if (files.length === 0) {
    console.log("No files found in ./data, exiting...");
    return process.exit(0);
  }

  const csv_files = files.filter((file) => file.endsWith(".csv"));
  const file = await select({
    message: "Choose a csv file",
    choices: csv_files.map((f) => ({ name: f, value: f })),
  });

  const file_with_tags = `${file.split(".csv")[0]}-with-tags.csv`;
  const file_with_tags_exists = fs.existsSync(`./out/${file_with_tags}`);

  const columns = await (async () => {
    const { stdout } = await util.promisify(exec)(`head -n 1 ./data/${file}`);
    return stdout.trim().split(",");
  })();

  if (!file_with_tags_exists) {
    await fs.promises.writeFile(`./out/${file_with_tags}`, `${columns.join(",")},tags`);
  }

  let startLine = 2;

  if (file_with_tags_exists) {
    const overwrite = await confirm({
      message: `File ${file_with_tags} already exists. Overwrite? (y/n)`,
      default: false,
    });

    if (overwrite) {
      await fs.promises.writeFile(`./out/${file_with_tags}`, `${columns.join(",")},tags`);
    } else {
      const { stdout } = await util.promisify(exec)(`cat ./out/${file_with_tags} | wc -l`);
      startLine += parseInt(stdout.trim()) - 1;
    }
  }

  let identifier_column: number = parseInt(
    await select({
      message: "Choose identifier column:",
      choices: columns.map((c, i) => ({ name: c, value: `${i}` })),
      pageSize: columns.length,
    })
  );

  const entries = await ((): Promise<string[][]> => {
    const rows: string[][] = [];
    return new Promise((resolve, reject) => {
      fs.createReadStream(`./data/${file}`)
        .pipe(parse({ delimiter: ",", skipEmptyLines: true, fromLine: startLine || undefined }))
        .on("data", async (row: string[]) => rows.push(row))
        .on("end", () => resolve(rows))
        .on("error", (error) => reject(error));
    });
  })();

  for (const row of entries) {
    const tags = await checkbox({
      message: `Choose tags for ${row[identifier_column]}`,
      choices: local_tags.map((tag) => ({ name: tag, value: tag })),
      instructions: false,
      pageSize: local_tags.length,
      validate: (ans) => {
        if (ans.length === 0) {
          return "At least 1 tag required";
        }
        if (ans.length > 3) {
          return "3 tags max";
        }
        return true;
      },
    });
    const row_string = [row.join(","), `${tags.join(" ")}`].join(",");
    await fs.promises.appendFile(
      `./out/${file_with_tags}`,
      `${entries.indexOf(row) === 0 && startLine === 2 ? "\n" : ""}${row_string}\n`
    );
  }

  console.log(`Done! File saved to ./out/${file_with_tags}`);
})();
