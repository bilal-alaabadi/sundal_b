const express = require("express");
const Products = require("./products.model");
const Reviews = require("../reviews/reviews.model");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const router = express.Router();
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),       // أو استخدم diskStorage حسب حاجتك
  limits: { fileSize: 5 * 1024 * 1024 }  // 5MB لكل ملف (عدّل حسب ما تريد)
});
// post a product
const { uploadImages } = require("../utils/uploadImage");

router.post("/uploadImages", async (req, res) => {
    try {
        const { images } = req.body; // images هي مصفوفة من base64
        if (!images || !Array.isArray(images)) {
            return res.status(400).send({ message: "يجب إرسال مصفوفة من الصور" });
        }

        const uploadedUrls = await uploadImages(images);
        res.status(200).send(uploadedUrls);
    } catch (error) {
        console.error("Error uploading images:", error);
        res.status(500).send({ message: "حدث خطأ أثناء تحميل الصور" });
    }
});

// نقطة النهاية لإنشاء منتج
const SUBCATEGORIES_MAP = {
  'العناية بالبشرة': ['صوابين', 'مقشرات', 'تونر', 'ماسكات'],
  'العناية بالشعر': ['شامبوهات', 'زيوت', 'أقنعة'],
  'العناية بالشفاه': ['مرطب', 'محدد', 'مقشر'],
  'العطور والبخور': [], // بدون أنواع
  'إكسسوارات العناية': ['لوفة', 'فرش', 'أدوات'],
};

router.post("/create-product", async (req, res) => {
  try {
    let { name, category, subcategory, description, oldPrice, price, image, author } = req.body;

    // تنظيف/تهيئة أولية
    name = typeof name === 'string' ? name.trim() : name;
    category = typeof category === 'string' ? category.trim() : category;
    subcategory = typeof subcategory === 'string' ? subcategory.trim() : subcategory;
    description = typeof description === 'string' ? description.trim() : description;
    price = price !== undefined ? Number(price) : price;
    oldPrice = oldPrice !== undefined && oldPrice !== '' ? Number(oldPrice) : undefined;

    // التحقق من الحقول الأساسية
    if (!name || !category || !description || price == null || !author) {
      return res.status(400).send({ message: "جميع الحقول المطلوبة يجب إرسالها" });
    }

    // التحقق من الصور (مصفوفة وبها عنصر واحد على الأقل)
    if (!Array.isArray(image) || image.length === 0) {
      return res.status(400).send({ message: "يجب إرسال صورة واحدة على الأقل" });
    }

    // إذا كانت الفئة لها أنواع فرعية، يجب إرسال subcategory والتحقق من صحته ضمن الخريطة
    const subcats = SUBCATEGORIES_MAP[category] || [];
    if (subcats.length > 0) {
      if (!subcategory) {
        return res.status(400).send({ message: "يجب تحديد النوع (subcategory) لهذه الفئة" });
      }
      if (!subcats.includes(subcategory)) {
        return res.status(400).send({ message: "النوع المرسل غير متوافق مع الفئة المختارة" });
      }
    } else {
      // فئات بلا أنواع -> تجاهل أي subcategory مرسل
      subcategory = undefined;
    }

    const productData = {
      name,
      category,
      subcategory, // قد تكون undefined إذا ما فيه أنواع
      description,
      price,
      oldPrice,
      image,
      author,
    };

    const newProduct = new Products(productData);
    const savedProduct = await newProduct.save();

    res.status(201).send(savedProduct);
  } catch (error) {
    console.error("Error creating new product", error);
    res.status(500).send({ message: "Failed to create new product" });
  }
});


// get all products
router.get("/", async (req, res) => {
  try {
    const {
      category,
      size,
      color,
      minPrice,
      maxPrice,
      page = 1,
      limit = 10,
    } = req.query;

    const filter = {};

    if (category && category !== "all") {
      filter.category = category;
      
      // إذا كانت الفئة حناء بودر وكان هناك حجم محدد
      if (category === 'حناء بودر' && size) {
        filter.size = size;
      }
    }

    if (color && color !== "all") {
      filter.color = color;
    }

    if (minPrice && maxPrice) {
      const min = parseFloat(minPrice);
      const max = parseFloat(maxPrice);
      if (!isNaN(min) && !isNaN(max)) {
        filter.price = { $gte: min, $lte: max };
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const totalProducts = await Products.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / parseInt(limit));

    const products = await Products.find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .populate("author", "email")
      .sort({ createdAt: -1 });

    res.status(200).send({ products, totalPages, totalProducts });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).send({ message: "Failed to fetch products" });
  }
});

//   get single Product
// get single Product (يدعم كلا المسارين)
router.get(["/:id", "/product/:id"], async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Products.findById(productId).populate(
      "author",
      "email username"
    );
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    const reviews = await Reviews.find({ productId }).populate(
      "userId",
      "username email"
    );
    res.status(200).send({ product, reviews });
  } catch (error) {
    console.error("Error fetching the product", error);
    res.status(500).send({ message: "Failed to fetch the product" });
  }
});

// update a product
router.patch(
  "/update-product/:id",
  verifyToken,
  verifyAdmin,
  upload.array('image'), 
  async (req, res) => {
    try {
      const productId = req.params.id;

      // قراءات أولية + تنظيف
      let {
        name,
        category,
        subcategory,   // 
        price,
        oldPrice,
        description,
        author,
      } = req.body;

      name = typeof name === 'string' ? name.trim() : name;
      category = typeof category === 'string' ? category.trim() : category;
      subcategory = typeof subcategory === 'string' ? subcategory.trim() : subcategory;
      description = typeof description === 'string' ? description.trim() : description;
      price = price !== undefined ? Number(price) : price;
      oldPrice = oldPrice !== undefined && oldPrice !== '' ? Number(oldPrice) : undefined;

      // تحقق أساسي
      if (!name || !category || price == null || !description) {
        return res.status(400).send({ message: "جميع الحقول المطلوبة يجب إرسالها" });
      }

      // تحقق subcategory حسب الفئة
      const subcats = SUBCATEGORIES_MAP[category] || [];
      if (subcats.length > 0) {
        if (!subcategory) {
          return res.status(400).send({ message: "يجب تحديد النوع (subcategory) لهذه الفئة" });
        }
        if (!subcats.includes(subcategory)) {
          return res.status(400).send({ message: "النوع المرسل غير متوافق مع الفئة المختارة" });
        }
      } else {
        subcategory = undefined; // تجاهل أي قيمة مرسلة
      }

      // الصور:
      // 1) الصور القديمة القادمة من الواجهة (كسلاسل روابط) عبر حقل existingImages[]
      // 2) الصور الجديدة المرفوعة الآن عبر req.files
      let existingImages = [];
      // إذا أرسلها كـ existingImages أو existingImages[]
      if (req.body.existingImages) {
        if (Array.isArray(req.body.existingImages)) {
          existingImages = req.body.existingImages.filter(Boolean);
        } else if (typeof req.body.existingImages === 'string' && req.body.existingImages.trim()) {
          // احتمال أرسلت كسلسلة JSON
          try {
            const parsed = JSON.parse(req.body.existingImages);
            if (Array.isArray(parsed)) existingImages = parsed.filter(Boolean);
          } catch {
            existingImages = [req.body.existingImages.trim()];
          }
        }
      }

      // الصور الجديدة: اعمل من req.files مصفوفة مسارات/روابط حسب تخزينك
      // (لو تستخدم Cloudinary/S3، بدّل هذه الخطوة بما يناسب)
      const uploadedImages = Array.isArray(req.files) && req.files.length > 0
        ? req.files.map(f => f.path || f.originalname) // عدّل كما يناسبك
        : [];

      const finalImages = [...existingImages, ...uploadedImages];

      // بناء بيانات التحديث
      const updateData = {
        name,
        category,
        subcategory, // قد تكون undefined
        price,
        oldPrice,
        description,
        author, // إن أردت منع التغيير تجاهله هنا
      };

      if (finalImages.length > 0) {
        updateData.image = finalImages;
      }

      const updatedProduct = await Products.findByIdAndUpdate(
        productId,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      if (!updatedProduct) {
        return res.status(404).send({ message: "المنتج غير موجود" });
      }

      res.status(200).send({
        message: "تم تحديث المنتج بنجاح",
        product: updatedProduct,
      });
    } catch (error) {
      console.error("خطأ في تحديث المنتج", error);
      res.status(500).send({
        message: "فشل تحديث المنتج",
        error: error.message
      });
    }
  }
);
// delete a product

router.delete("/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    const deletedProduct = await Products.findByIdAndDelete(productId);

    if (!deletedProduct) {
      return res.status(404).send({ message: "Product not found" });
    }

    // delete reviews related to the product
    await Reviews.deleteMany({ productId: productId });

    res.status(200).send({
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting the product", error);
    res.status(500).send({ message: "Failed to delete the product" });
  }
});

// get related products
router.get("/related/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).send({ message: "Product ID is required" });
    }
    const product = await Products.findById(id);
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }

    const titleRegex = new RegExp(
      product.name
        .split(" ")
        .filter((word) => word.length > 1)
        .join("|"),
      "i"
    );

    const relatedProducts = await Products.find({
      _id: { $ne: id }, // Exclude the current product
      $or: [
        { name: { $regex: titleRegex } }, // Match similar names
        { category: product.category }, // Match the same category
      ],
    });

    res.status(200).send(relatedProducts);

  } catch (error) {
    console.error("Error fetching the related products", error);
    res.status(500).send({ message: "Failed to fetch related products" });
  }
});

module.exports = router;
